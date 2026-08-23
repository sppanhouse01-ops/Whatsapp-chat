import React, { useState, useEffect, useRef } from 'react';
import { useChatStore } from '../../store/useChatStore';
import { useAuthStore } from '../../store/useAuthStore';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import { MessageBubble } from '../chat/MessageBubble';
import { MessageInput } from '../chat/MessageInput';
import { VoiceCallModal } from '../chat/VoiceCallModal';
import { Download, Sparkles, RefreshCw, MessageSquare, Phone, FileText, ArrowLeft, Trash2, MoreVertical, Eraser, UserCheck, Smartphone } from 'lucide-react';
import type { User, Message } from '../../types';
import { sounds } from '../../utils/audio';
import { exportChatAsPdf, exportChatAsTxt } from '../../utils/exportChat';
import { installPwaApp } from '../../utils/pwa';

interface AdminChatAreaProps {
  onToggleContextPanel?: () => void;
  showContextPanel?: boolean;
}

export const AdminChatArea: React.FC<AdminChatAreaProps> = ({ onToggleContextPanel, showContextPanel }) => {
  const { activeConversation, messages, fetchMessages, addMessage, markAllMessagesRead, fetchConversations, typingState, onlineCustomers, setActiveConversation, deleteConversation, clearChat } = useChatStore();
  const { user } = useAuthStore();
  const [agents, setAgents] = useState<User[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const [isAiBotActive, setIsAiBotActive] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationRef = useRef(activeConversation);
  const isAiBotActiveRef = useRef(isAiBotActive);
  const userRef = useRef(user);
  const aiDebounceTimerRef = useRef<any>(null);
  const socket = getSocket();

  useEffect(() => {
    activeConversationRef.current = activeConversation;
    isAiBotActiveRef.current = isAiBotActive;
    userRef.current = user;
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    loadAgents();
    if (user?._id) {
      socket.emit('join_agent_workspace', { userId: user._id });
    }
  }, [user?._id]);

  // Fast Conversation Switch & Guaranteed Message Fetch
  useEffect(() => {
    if (activeConversation?._id) {
      fetchMessages(activeConversation._id);

      socket.emit('join_conversation', {
        conversationId: activeConversation._id,
        role: 'agent',
        userId: user?._id
      });
      socket.emit('mark_read', { conversationId: activeConversation._id, readerType: 'agent' });

      // Debounced AI Suggestions (runs smoothly in background)
      if (aiDebounceTimerRef.current) clearTimeout(aiDebounceTimerRef.current);
      aiDebounceTimerRef.current = setTimeout(() => {
        fetchAISuggestions();
      }, 250);
    }
    return () => {
      if (aiDebounceTimerRef.current) clearTimeout(aiDebounceTimerRef.current);
    };
  }, [activeConversation?._id]);

  // Stable Socket Listeners (Registered Once)
  useEffect(() => {
    const handleReceive = (msg: Message) => {
      addMessage(msg);
      sounds.playReceived();
      const currentActive = activeConversationRef.current;
      if (currentActive) {
        socket.emit('mark_read', { conversationId: currentActive._id, readerType: 'agent' });

        if (isAiBotActiveRef.current && msg.senderType === 'customer') {
          setTimeout(async () => {
            try {
              const aiData = await api.getAISuggestions(currentActive._id);
              if (aiData.suggestions && aiData.suggestions.length > 0) {
                const replyText = aiData.suggestions[0];
                const aiMsg = await api.sendMessage({
                  conversationId: currentActive._id,
                  senderType: 'agent',
                  senderId: userRef.current?._id || 'ai_bot',
                  senderName: 'Support AI Executive 🤖',
                  content: replyText
                });
                addMessage(aiMsg);
                socket.emit('send_message', aiMsg);
                sounds.playSent();
              }
            } catch (err) {
              console.error('AI Auto-reply error:', err);
            }
          }, 1200);
        }
      }
    };

    const handleReadAck = ({ conversationId }: { conversationId: string }) => {
      markAllMessagesRead(conversationId);
    };

    const handleStatusUpdate = ({ messageId, status }: { messageId: string; status: any }) => {
      useChatStore.setState((state) => ({
        messages: state.messages.map((m) =>
          m._id === messageId ? { ...m, status } : m
        )
      }));
    };

    const handleTyping = ({ conversationId, senderName, senderType, isTyping }: { conversationId: string; senderName: string; senderType: string; isTyping: boolean }) => {
      const store = useChatStore.getState();
      store.setTyping(conversationId, senderName, isTyping, senderType);
    };

    socket.on('receive_message', handleReceive);
    socket.on('messages_read_ack', handleReadAck);
    socket.on('message_status_update', handleStatusUpdate);
    socket.on('user_typing', handleTyping);

    return () => {
      socket.off('receive_message', handleReceive);
      socket.off('messages_read_ack', handleReadAck);
      socket.off('message_status_update', handleStatusUpdate);
      socket.off('user_typing', handleTyping);
    };
  }, [socket]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const loadAgents = async () => {
    try {
      const list = await api.getAgents();
      setAgents(list);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAISuggestions = async () => {
    if (!activeConversation) return;
    setIsGeneratingAI(true);
    try {
      const data = await api.getAISuggestions(activeConversation._id);
      setAiSuggestions(data.suggestions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleAssignAgent = async (agentId: string) => {
    if (!activeConversation) return;
    try {
      await api.assignAgent(activeConversation._id, agentId || null);
      fetchConversations();
    } catch (err) {
      console.error(err);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!activeConversation) return;
    try {
      await api.updateStatus(activeConversation._id, status);
      fetchConversations();
    } catch (err) {
      console.error(err);
    }
  };

  const handlePriorityChange = async (priority: string) => {
    if (!activeConversation) return;
    try {
      await api.updateStatus(activeConversation._id, undefined, priority);
      fetchConversations();
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportPDF = () => {
    if (!activeConversation) return;
    exportChatAsPdf(messages, activeConversation.customer?.name || 'Customer');
  };

  const handleExportTXT = () => {
    if (!activeConversation) return;
    exportChatAsTxt(messages, activeConversation.customer?.name || 'Customer');
  };

  const handleDeleteChat = async () => {
    if (!activeConversation) return;
    try {
      setIsProcessing(true);
      await deleteConversation(activeConversation._id);
      setShowDeleteModal(false);
    } catch (err) {
      console.error('Delete chat error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearChat = async () => {
    if (!activeConversation) return;
    try {
      setIsProcessing(true);
      await clearChat(activeConversation._id);
      setShowClearModal(false);
    } catch (err) {
      console.error('Clear chat error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInstallPwa = async () => {
    setShowMoreMenu(false);
    const res = await installPwaApp();
    if (res.message) {
      alert(res.message);
    }
  };

  if (!activeConversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#efeae2] dark:bg-[#0b141a] text-[#8696a0] p-8 text-center border-r border-[#e9edef] dark:border-[#222d34]">
        <div className="w-20 h-20 rounded-3xl bg-white dark:bg-[#202c33] shadow-md flex items-center justify-center mb-5 text-[#00a884] border border-black/[0.06] dark:border-white/[0.08]">
          <MessageSquare className="w-9 h-9" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-[#111b21] dark:text-[#e9edef]">WhatsApp Web Enterprise Support</h2>
        <p className="text-xs text-[#667781] dark:text-[#8696a0] max-w-sm mt-2 font-medium">
          Select a conversation from the left sidebar to start live assistance, trigger AI suggestions, and manage customer notes.
        </p>
      </div>
    );
  }

  const customerName = activeConversation.customer?.name || 'Customer';
  const isCustomerTyping = typingState[activeConversation._id]?.senderType === 'customer' && typingState[activeConversation._id]?.isTyping;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#efeae2] dark:bg-[#0b141a] relative border-r border-[#e9edef] dark:border-[#222d34] min-w-0 overflow-hidden transition-colors duration-300">
      {/* WhatsApp Clean Header Bar */}
      <div className="bg-[#f0f2f5] dark:bg-[#202c33] px-3.5 py-2.5 border-b border-[#e9edef] dark:border-[#222d34] flex items-center justify-between gap-3 shadow-xs z-20 shrink-0 h-[58px]">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Back Button (Mobile Only) */}
          <button
            onClick={() => setActiveConversation(null)}
            className="p-1.5 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] rounded-full md:hidden text-[#8696a0] transition-colors cursor-pointer"
            title="Back to chats"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button
            onClick={onToggleContextPanel}
            className={`relative cursor-pointer group/dp focus:outline-none shrink-0 rounded-full transition-all ${
              showContextPanel ? 'ring-2 ring-[#00a884] ring-offset-2 ring-offset-white dark:ring-offset-[#202c33]' : ''
            }`}
            title="Click to view full CRM customer profile"
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-xs group-hover/dp:scale-105 transition-transform"
              style={{ background: `hsl(${(customerName.charCodeAt(0) || 65) * 11 % 360}, 50%, 42%)` }}
            >
              {customerName.charAt(0).toUpperCase()}
            </div>
            <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-[#202c33] transition-colors ${
              (activeConversation.customer?._id && onlineCustomers.includes(activeConversation.customer._id)) ||
              (activeConversation.customer?.sessionId && onlineCustomers.includes(activeConversation.customer.sessionId))
                ? 'bg-[#25D366]'
                : 'bg-[#8696a0]/40'
            }`} />
          </button>

          <div className="min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="text-sm font-semibold tracking-tight text-[#111b21] dark:text-[#e9edef] truncate">{customerName}</h2>
              {activeConversation.customer?.phone && (
                <span className="text-[11px] text-[#8696a0] font-mono shrink-0 hidden sm:inline">{activeConversation.customer.phone}</span>
              )}
            </div>
            <p className="text-[11px] font-medium leading-tight truncate">
              {isCustomerTyping ? (
                <span className="font-semibold animate-pulse text-[#00a884]">Customer is typing...</span>
              ) : (activeConversation.customer?._id && onlineCustomers.includes(activeConversation.customer._id)) ||
                  (activeConversation.customer?.sessionId && onlineCustomers.includes(activeConversation.customer.sessionId)) ? (
                <span className="text-[#00a884]">Online</span>
              ) : (
                <span className="text-[#8696a0]">Offline</span>
              )}
            </p>
          </div>
        </div>

        {/* Clean Header Right Actions: Voice Call + 3-Dots Menu */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowVoiceCall(true)}
            title="Voice Call"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-all active:scale-95 cursor-pointer"
          >
            <Phone className="w-4 h-4" />
          </button>

          {/* 3-Dots Dropdown Trigger */}
          <div ref={moreMenuRef} className="relative">
            <button
              onClick={() => setShowMoreMenu(p => !p)}
              title="More Actions"
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                showMoreMenu
                  ? 'bg-black/10 dark:bg-white/15 text-[#111b21] dark:text-white'
                  : 'text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
              }`}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                <div className="absolute right-0 top-11 w-72 max-w-[90vw] bg-white dark:bg-[#202c33] border border-black/[0.08] dark:border-white/[0.1] rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150 text-[#111b21] dark:text-[#e9edef] space-y-3">
                  {/* Chat Controls & Settings in 3-Dots Menu */}
                  <div className="space-y-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#8696a0] px-1">
                      Conversation Controls
                    </div>

                    {/* AI Auto-Bot Toggle */}
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-[#f0f2f5] dark:bg-[#111b21] border border-black/[0.04] dark:border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-semibold">AI Auto-Bot</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsAiBotActive(!isAiBotActive)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          isAiBotActive
                            ? 'bg-[#00a884] text-white shadow-xs'
                            : 'bg-black/10 dark:bg-white/10 text-[#667781] dark:text-[#8696a0]'
                        }`}
                      >
                        {isAiBotActive ? 'ACTIVE' : 'OFF'}
                      </button>
                    </div>

                    {/* Status Selector */}
                    <div>
                      <label className="text-[11px] font-medium text-[#8696a0] px-1 mb-1 block">Status</label>
                      <select
                        value={activeConversation.status}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        className="w-full bg-[#f0f2f5] dark:bg-[#111b21] text-xs text-[#111b21] dark:text-[#e9edef] border border-black/[0.06] dark:border-white/[0.08] rounded-xl px-3 py-2 outline-none font-medium cursor-pointer"
                      >
                        <option value="open">🟢 Open</option>
                        <option value="pending">🟡 Pending</option>
                        <option value="resolved">🔵 Resolved</option>
                        <option value="closed">⚪ Closed</option>
                      </select>
                    </div>

                    {/* Priority Selector */}
                    <div>
                      <label className="text-[11px] font-medium text-[#8696a0] px-1 mb-1 block">Priority</label>
                      <select
                        value={activeConversation.priority}
                        onChange={(e) => handlePriorityChange(e.target.value)}
                        className="w-full bg-[#f0f2f5] dark:bg-[#111b21] text-xs text-[#111b21] dark:text-[#e9edef] border border-black/[0.06] dark:border-white/[0.08] rounded-xl px-3 py-2 outline-none font-medium cursor-pointer"
                      >
                        <option value="low">Low Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="high">High Priority</option>
                        <option value="urgent">Urgent 🔥</option>
                      </select>
                    </div>

                    {/* Assign Agent Selector */}
                    <div>
                      <label className="text-[11px] font-medium text-[#8696a0] px-1 mb-1 block">Assign Agent</label>
                      <select
                        value={activeConversation.assignedAgent?._id || ''}
                        onChange={(e) => handleAssignAgent(e.target.value)}
                        className="w-full bg-[#f0f2f5] dark:bg-[#111b21] text-xs text-[#111b21] dark:text-[#e9edef] border border-black/[0.06] dark:border-white/[0.08] rounded-xl px-3 py-2 outline-none font-medium cursor-pointer"
                      >
                        <option value="">Unassigned</option>
                        {agents.map((ag) => (
                          <option key={ag._id} value={ag._id}>{ag.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="border-t border-black/[0.06] dark:border-white/[0.08] pt-2 space-y-1">
                    <button
                      onClick={handleInstallPwa}
                      className="w-full text-left px-3 py-2 text-xs rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] flex items-center justify-between transition-colors cursor-pointer text-[#111b21] dark:text-[#e9edef] font-medium"
                    >
                      <span className="flex items-center gap-2.5">
                        <Smartphone className="w-4 h-4 text-[#00a884]" /> Add to Home screen
                      </span>
                      <span className="text-[10px] text-[#00a884] font-semibold bg-[#00a884]/15 px-2 py-0.5 rounded-full">App</span>
                    </button>
                    <button
                      onClick={() => { setShowMoreMenu(false); onToggleContextPanel && onToggleContextPanel(); }}
                      className="w-full text-left px-3 py-2 text-xs rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <UserCheck className="w-4 h-4 text-[#00a884]" /> View Customer Profile
                    </button>
                    <button
                      onClick={() => { setShowMoreMenu(false); handleExportPDF(); }}
                      className="w-full text-left px-3 py-2 text-xs rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-[#00a884]" /> Export Chat (PDF)
                    </button>
                    <button
                      onClick={() => { setShowMoreMenu(false); handleExportTXT(); }}
                      className="w-full text-left px-3 py-2 text-xs rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#8696a0]" /> Export Chat (TXT)
                    </button>
                  </div>

                  <div className="border-t border-black/[0.06] dark:border-white/[0.08] pt-2 space-y-1">
                    <button
                      onClick={() => { setShowMoreMenu(false); setShowClearModal(true); }}
                      className="w-full text-left px-3 py-2 text-xs rounded-xl text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 flex items-center gap-2.5 transition-colors font-medium cursor-pointer"
                    >
                      <Eraser className="w-4 h-4 text-amber-500" /> Clear Messages History
                    </button>
                    <button
                      onClick={() => { setShowMoreMenu(false); setShowDeleteModal(true); }}
                      className="w-full text-left px-3 py-2 text-xs rounded-xl text-red-500 hover:bg-red-500/10 flex items-center gap-2.5 transition-colors font-semibold cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" /> Delete Entire Chat
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Voice Call Modal ── */}
      {showVoiceCall && (
        <VoiceCallModal
          contactName={customerName}
          phoneNumber={activeConversation.customer?.phone || "+91 9876543210"}
          onClose={() => setShowVoiceCall(false)}
        />
      )}

      {/* AI Suggested Replies Bar */}
      <div className="bg-white/80 dark:bg-[#111b21]/80 backdrop-blur-xl px-4 py-2 border-b border-[#e9edef] dark:border-[#222d34] flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-500 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Smart Suggestions:</span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto flex-1 no-scrollbar">
          {isGeneratingAI ? (
            <span className="text-xs text-[#8696a0] italic">Generating smart suggestions...</span>
          ) : (
            aiSuggestions.map((sug, idx) => (
              <button
                key={idx}
                onClick={async () => {
                  const msg = await api.sendMessage({
                    conversationId: activeConversation._id,
                    senderType: 'agent',
                    senderId: user?._id || 'agent',
                    senderName: user?.name || 'Support Agent',
                    content: sug
                  });
                  addMessage(msg);
                  socket.emit('send_message', msg);
                }}
                className="text-xs text-[#111b21] dark:text-[#e9edef] bg-white dark:bg-[#202c33] border border-black/[0.08] dark:border-white/[0.1] hover:border-[#00a884] hover:text-[#00a884] px-3.5 py-1 rounded-full truncate max-w-xs transition-all shrink-0 shadow-2xs active:scale-95"
              >
                {sug}
              </button>
            ))
          )}
        </div>

        <button onClick={fetchAISuggestions} title="Refresh Suggestions" className="p-1 text-[#8696a0] hover:text-[#111b21] dark:hover:text-white transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages Canvas */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 chat-wallpaper">
        {(() => {
          const deduplicatedMessages: Message[] = [];
          const seenMsgKeys = new Set<string>();

          for (const m of messages) {
            const isWelcome = m.senderId === 'agent_auto_welcome' || (m.content && (m.content.includes('SUPREME') || m.content.includes('DlAM0ND') || m.content.includes('allpanelexch9') || m.content.includes('DIAMOND')));
            const isPrompt = m.senderId === 'agent_auto_prompt' || (m.content && (m.content.includes('Please enter your name') || m.content.includes('Please share your name')));

            let msgKey = m._id || `${m.senderId}_${m.content}`;
            if (isWelcome) {
              msgKey = 'unique_auto_welcome';
            } else if (isPrompt) {
              msgKey = 'unique_auto_prompt';
            }

            if (!seenMsgKeys.has(msgKey)) {
              seenMsgKeys.add(msgKey);
              deduplicatedMessages.push(m);
            }
          }

          if (deduplicatedMessages.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center text-[#8696a0]">
                <div className="w-12 h-12 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center mb-3">
                  <MessageSquare className="w-6 h-6 text-[#00a884]" />
                </div>
                <p className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">No messages yet</p>
                <p className="text-xs text-[#8696a0] mt-1 max-w-xs">Customer has not sent any message in this session yet. You can start the conversation below.</p>
              </div>
            );
          }

          return deduplicatedMessages.map((msg) => (
            <MessageBubble
              key={`${msg._id}_${msg.status}`}
              message={msg}
              currentUserId={user?._id}
              isAgentView={true}
            />
          ));
        })()}

        {isCustomerTyping && (
          <div className="flex items-center gap-1.5 bg-white/90 dark:bg-[#202c33]/90 backdrop-blur-xl px-3.5 py-2 rounded-full w-fit shadow-xs border border-black/[0.04] dark:border-white/[0.06]">
            <span className="w-1.5 h-1.5 bg-[#00a884] rounded-full animate-bounce" />
            <span className="w-1.5 h-1.5 bg-[#00a884] rounded-full animate-bounce [animation-delay:0.2s]" />
            <span className="w-1.5 h-1.5 bg-[#00a884] rounded-full animate-bounce [animation-delay:0.4s]" />
            <span className="text-[11px] font-medium text-[#00a884] ml-1">Customer is typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Dock */}
      <MessageInput
        conversationId={activeConversation._id}
        senderType="agent"
        senderId={user?._id || 'agent'}
        senderName={user?.name || 'Support Agent'}
        isAgentView={true}
      />

      {/* Delete Chat Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in"
            onClick={() => !isProcessing && setShowDeleteModal(false)}
          />
          <div className="relative w-full max-w-sm bg-white dark:bg-[#202c33] rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.1] p-5 z-10 animate-in fade-in zoom-in-95 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center mx-auto mb-3.5 shadow-xs">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">
              Delete chat with {customerName}?
            </h3>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1.5 leading-relaxed">
              This will permanently delete this conversation and all its messages. This action cannot be undone.
            </p>
            <div className="flex items-center gap-2.5 mt-5">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-xs font-semibold text-[#111b21] dark:text-[#e9edef] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleDeleteChat}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold shadow-md shadow-red-500/25 transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer disabled:opacity-50"
              >
                {isProcessing ? 'Deleting...' : 'Delete Chat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Messages Confirmation Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in"
            onClick={() => !isProcessing && setShowClearModal(false)}
          />
          <div className="relative w-full max-w-sm bg-white dark:bg-[#202c33] rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.1] p-5 z-10 animate-in fade-in zoom-in-95 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center mx-auto mb-3.5 shadow-xs">
              <Eraser className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">
              Clear messages in this chat?
            </h3>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1.5 leading-relaxed">
              All messages in this conversation will be cleared, but the customer contact will remain in your list.
            </p>
            <div className="flex items-center gap-2.5 mt-5">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setShowClearModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-xs font-semibold text-[#111b21] dark:text-[#e9edef] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleClearChat}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-md shadow-amber-500/25 transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer disabled:opacity-50"
              >
                {isProcessing ? 'Clearing...' : 'Clear History'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
