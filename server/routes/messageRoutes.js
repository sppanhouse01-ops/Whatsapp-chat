import express from 'express';
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';
import { Customer } from '../models/Customer.js';
import { onlineAgents, onlineCustomers, activeChatRooms } from '../socket/index.js';

const router = express.Router();

// @route GET /api/messages/:conversationId
router.get('/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;

    let messages = await Message.find({ conversation: conversationId })
      .populate('replyTo')
      .sort({ createdAt: 1 });

    if (messages.length === 0) {
      // Check if this customer has messages in another conversation with same phone/name/session
      const currentConv = await Conversation.findById(conversationId).populate('customer');
      if (currentConv && currentConv.customer) {
        const custName = currentConv.customer.name;
        const custPhone = currentConv.customer.phone;
        const searchOr = [{ _id: currentConv.customer._id }];
        if (custPhone && custPhone.trim() !== '') searchOr.push({ phone: custPhone });
        if (custName && !custName.startsWith('Guest_')) searchOr.push({ name: custName });

        const matchingCustomers = await Customer.find({ $or: searchOr }).select('_id');
        const custIds = matchingCustomers.map(c => c._id);
        const relatedConvs = await Conversation.find({ customer: { $in: custIds } }).select('_id');
        const convIds = relatedConvs.map(c => c._id);

        messages = await Message.find({ conversation: { $in: convIds } })
          .populate('replyTo')
          .sort({ createdAt: 1 });
      }
    }

    // Clean up any old system greetings
    const cleanMessages = [];
    const seenMsgIds = new Set();
    for (const msg of messages) {
      if (msg.senderType === 'system' || (msg.content && msg.content.includes('Welcome to our Live Support'))) {
        Message.findByIdAndDelete(msg._id).catch(() => {});
        continue;
      }

      if (!seenMsgIds.has(msg._id.toString())) {
        seenMsgIds.add(msg._id.toString());
        cleanMessages.push(msg);
      }
    }

    // Sort by creation time; guarantee initial prompt is at the top if present
    cleanMessages.sort((a, b) => {
      const aIsPrompt = a.senderId === 'agent_auto_prompt' || (a.content && a.content.includes('Please enter your name'));
      const bIsPrompt = b.senderId === 'agent_auto_prompt' || (b.content && b.content.includes('Please enter your name'));

      if (aIsPrompt && !bIsPrompt) return -1;
      if (!aIsPrompt && bIsPrompt) return 1;

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    res.json(cleanMessages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route POST /api/messages
router.post('/', async (req, res) => {
  try {
    const {
      conversationId,
      senderType,
      senderId,
      senderName,
      content,
      type,
      fileUrl,
      fileName,
      fileSize,
      mimeType,
      replyToId
    } = req.body;

    let replyToSnippet = null;
    if (replyToId) {
      const origMsg = await Message.findById(replyToId);
      if (origMsg) {
        replyToSnippet = {
          content: origMsg.content || origMsg.fileName || 'Attachment',
          senderName: origMsg.senderName,
          type: origMsg.type
        };
      }
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    let initialStatus = 'sent';
    if (senderType === 'customer') {
      const isAgentOnline = onlineAgents.size > 0;
      if (isAgentOnline) {
        let isAgentInThisRoom = false;
        const agentSocketIds = new Set(onlineAgents.values());
        for (const [sId, convId] of activeChatRooms.entries()) {
          if (convId === conversationId && agentSocketIds.has(sId)) {
            isAgentInThisRoom = true;
            break;
          }
        }
        initialStatus = isAgentInThisRoom ? 'read' : 'delivered';
      } else {
        initialStatus = 'sent';
      }
    } else if (senderType === 'agent') {
      const custId = conversation.customer.toString();
      const customerSocketId = onlineCustomers.get(custId);
      if (customerSocketId) {
        const openConvId = activeChatRooms.get(customerSocketId);
        initialStatus = openConvId === conversationId ? 'read' : 'delivered';
      } else {
        initialStatus = 'sent';
      }
    }

    const message = await Message.create({
      conversation: conversationId,
      senderType,
      senderId,
      senderName,
      content: content || '',
      type: type || 'text',
      fileUrl: fileUrl || '',
      fileName: fileName || '',
      fileSize: fileSize || 0,
      mimeType: mimeType || '',
      replyTo: replyToId || null,
      replyToSnippet,
      status: initialStatus
    });

    // Update conversation lastMessage & unread counts
    if (conversation) {
      const now = new Date();
      conversation.lastMessage = {
        content: content || fileName || `[${type || 'attachment'}]`,
        senderType,
        type: type || 'text',
        timestamp: now
      };
      conversation.updatedAt = now;

      if (senderType === 'customer') {
        if (initialStatus === 'read') {
          conversation.unreadCount = 0;
        } else {
          conversation.unreadCount += 1;
        }
        if (conversation.customer) {
          const updatePayload = { isGuest: false, lastSeen: now };
          if (senderName && !senderName.startsWith('Guest_') && senderName !== 'Visitor') {
            updatePayload.name = senderName;
          }
          await Customer.findByIdAndUpdate(conversation.customer, { $set: updatePayload });
        }
      } else if (senderType === 'agent') {
        if (initialStatus === 'read') {
          conversation.unreadCountCustomer = 0;
        } else {
          conversation.unreadCountCustomer += 1;
        }
      }

      await conversation.save();
    }

    const populatedMsg = await Message.findById(message._id).populate('replyTo');

    if (req.io) {
      req.io.to(`conv_${conversationId}`).emit('receive_message', populatedMsg);
      req.io.to('agent_workspace_room').emit('conversation_activity', populatedMsg);
    }

    // Auto-send Welcome Message after customer sends their name / first message (Strictly Once)
    if (senderType === 'customer') {
      const hasWelcome = await Message.exists({
        conversation: conversationId,
        $or: [
          { senderId: 'agent_auto_welcome' },
          { content: { $regex: 'SUPREME EXCHANGE|DlAM0ND|allpanelexch9|DIAMOND', $options: 'i' } }
        ]
      });

      if (!hasWelcome) {
        setTimeout(async () => {
          try {
            const alreadySent = await Message.exists({
              conversation: conversationId,
              $or: [
                { senderId: 'agent_auto_welcome' },
                { content: { $regex: 'SUPREME EXCHANGE|DlAM0ND|allpanelexch9|DIAMOND', $options: 'i' } }
              ]
            });
            if (alreadySent) return;

            const welcomeText = `✅★ WELCOME TO SUPREME EXCHANGE ★✅
(Jaisa naam vaisa kaam) 
💴💰Best ever trusted site
            15 minutes withdrawal guarantee 

Panels:
👉 Allpanel exchange 
👉 Diamond exchange 
👉King365 Exchange
👉🅱️etsmart7 Exchange

WE ARE PROVIDING MULTIPLE AND ORIGINAL Exchanges FOR YOU 😍

🟠 10% Bonus On NEW 🆔💴💰💵
🟣 03% BONUS ON EVERY DEPOSIT LIFETIME

Available premium S!tes


💎 DIAM0ND €XCHANGE
🌐 https://allpanel9.global/login
Login with demo 🆔

👑👑K!NG EXCHANGE👑👑
🌐https://www.kingexch365.com
Login with demo 🆔


➡️ ALLPANEL €XCHANGE ⬅️
🌐 www.allpanel9.global/login
Login with demo 🆔

''🅱️et Smart Exchange''
🌐https://www.betsmart7.com
Login with demo 🆔



(Minimum DEPOSIT & Withdrawal ₹. 300)


✅FASTEST & GENUINE SERVICE GUARANTEE
SINCE 2018❤️✅`;

            const welcomeMsg = await Message.create({
              conversation: conversationId,
              senderType: 'agent',
              senderId: 'agent_auto_welcome',
              senderName: 'Support Official',
              content: welcomeText,
              status: 'delivered'
            });

            if (req.io) {
              req.io.to(`conv_${conversationId}`).emit('receive_message', welcomeMsg);
              req.io.to('agent_workspace_room').emit('conversation_activity', welcomeMsg);
            }
          } catch (wErr) {
            console.error('Auto welcome error:', wErr);
          }
        }, 400);
      }
    }

    res.status(201).json(populatedMsg);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route PUT /api/messages/:id/edit
router.put('/:id/edit', async (req, res) => {
  try {
    const { content } = req.body;
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    message.content = content;
    message.isEdited = true;
    await message.save();

    res.json(message);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route DELETE /api/messages/:id
router.delete('/:id', async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    message.isDeleted = true;
    message.content = 'This message was deleted';
    message.fileUrl = '';
    await message.save();

    if (req.io) {
      req.io.emit('message_deleted', { messageId: message._id, conversationId: message.conversation });
    }

    res.json(message);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route POST /api/messages/:id/react
router.post('/:id/react', async (req, res) => {
  try {
    const { emoji, by, byName } = req.body;
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    const existingIdx = message.reactions.findIndex(r => r.by === by && r.emoji === emoji);
    if (existingIdx > -1) {
      // Toggle off reaction
      message.reactions.splice(existingIdx, 1);
    } else {
      // Filter out previous reaction by same user if any, then add new one
      message.reactions = message.reactions.filter(r => r.by !== by);
      message.reactions.push({ emoji, by, byName });
    }

    await message.save();
    res.json(message);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route PUT /api/messages/:id/status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body; // 'delivered' | 'read'
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    message.status = status;
    await message.save();
    res.json(message);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
