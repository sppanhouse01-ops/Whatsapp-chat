import express from 'express';
import { Customer } from '../models/Customer.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Setting } from '../models/Setting.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// @route POST /api/customer/init
// Register or restore customer session and get or create active conversation
router.post('/init', async (req, res) => {
  try {
    let { sessionId, name, phone, isGuest, metadata } = req.body;

    let customer = null;

    if (sessionId) {
      customer = await Customer.findOne({ sessionId });
    }

    // Lookup customer by Phone number or Name if sessionId not found
    if (!customer) {
      const searchConditions = [];
      if (phone && phone.trim() !== '') {
        const cleanPhone = phone.trim();
        const digitsOnly = cleanPhone.replace(/\D/g, '');
        searchConditions.push({ phone: cleanPhone });
        if (digitsOnly.length >= 6) {
          searchConditions.push({ phone: new RegExp(digitsOnly + '$', 'i') });
        }
      }
      if (name && name.trim() !== '') {
        const cleanName = name.trim();
        const firstName = cleanName.split(' ')[0];
        searchConditions.push({ name: new RegExp('^' + firstName, 'i') });
      }

      if (searchConditions.length > 0) {
        customer = await Customer.findOne({ $or: searchConditions });
        if (customer) {
          if (name && name.trim() !== '') customer.name = name.trim();
          if (phone && phone.trim() !== '') customer.phone = phone.trim();
          customer.lastSeen = new Date();
          await customer.save();
        }
      }
    }

    if (!customer) {
      sessionId = sessionId || uuidv4();
      const defaultName = isGuest ? `Guest_${Math.floor(1000 + Math.random() * 9000)}` : (name || 'Anonymous User');
      const defaultPhone = phone ? phone.trim() : `+1 (${Math.floor(100 + Math.random() * 899)}) ${Math.floor(100 + Math.random() * 899)}-${Math.floor(1000 + Math.random() * 8999)}`;

      customer = await Customer.create({
        sessionId,
        name: defaultName,
        phone: defaultPhone,
        isGuest: isGuest || false,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(defaultName)}`,
        metadata: metadata || {}
      });
    } else {
      // Update customer details if provided
      if (name && name.trim() !== '') {
        customer.name = name.trim();
        if (!name.startsWith('Guest_')) {
          customer.isGuest = false;
        }
      }
      if (phone && phone.trim() !== '') customer.phone = phone.trim();
      customer.lastSeen = new Date();
      await customer.save();
    }

    // Find or create active conversation for this customer
    let conversation = await Conversation.findOne({ customer: customer._id })
      .populate('assignedAgent', 'name avatar role email phone status');

    let welcomeMessage = `✅★ WELCOME TO SUPREME EXCHANGE ★✅
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

    const namePromptMessage = 'Please enter your name for Id';

    if (!conversation) {
      conversation = await Conversation.create({
        customer: customer._id,
        status: 'open',
        priority: 'medium',
        lastMessage: {
          content: namePromptMessage,
          senderType: 'agent',
          timestamp: new Date()
        }
      });

      // Send initial prompt asking for name for ID
      await Message.create({
        conversation: conversation._id,
        senderType: 'agent',
        senderId: 'agent_auto_prompt',
        senderName: 'Support Official',
        content: namePromptMessage
      });

      conversation = await Conversation.findById(conversation._id)
        .populate('assignedAgent', 'name avatar role email phone status');
    } else {
      // If conversation exists with 0 messages, ensure initial prompt is present
      const msgCount = await Message.countDocuments({ conversation: conversation._id });
      if (msgCount === 0) {
        await Message.create({
          conversation: conversation._id,
          senderType: 'agent',
          senderId: 'agent_auto_prompt',
          senderName: 'Support Official',
          content: namePromptMessage
        });
      }
    }

    const messages = await Message.find({ conversation: conversation._id })
      .populate('replyTo')
      .sort({ createdAt: 1 });

    res.json({
      customer,
      conversation,
      messages
    });
  } catch (error) {
    console.error('Customer init error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route GET /api/customer/session/:sessionId
router.get('/session/:sessionId', async (req, res) => {
  try {
    const customer = await Customer.findOne({ sessionId: req.params.sessionId });
    if (!customer) {
      return res.status(404).json({ message: 'Session not found' });
    }
    const conversation = await Conversation.findOne({ customer: customer._id })
      .populate('assignedAgent', 'name avatar role email phone status');

    res.json({ customer, conversation });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
