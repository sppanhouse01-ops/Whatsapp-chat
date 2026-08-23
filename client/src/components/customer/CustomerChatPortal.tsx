import React, { useState, useEffect, useRef } from 'react';
import { useChatStore } from '../../store/useChatStore';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import { MessageBubble } from '../chat/MessageBubble';
import { EmojiPickerModal } from '../chat/EmojiPickerModal';
import { VoiceCallModal } from '../chat/VoiceCallModal';
import { GetIdModal } from '../chat/GetIdModal';
import type { Message, MessageType } from '../../types';
import { sounds } from '../../utils/audio';
import { exportChatAsTxt, exportChatAsPdf } from '../../utils/exportChat';
import { trackPixelLead, trackPixelPageView } from '../../utils/pixel';
import { installPwaApp } from '../../utils/pwa';
import {
  X, Smile, Paperclip, Mic, Send,
  Bell, MoreVertical, Moon, Sun, Download, FileText,
  Image as ImageIcon, Camera, File, Music, ArrowDown,
  Trash2, Phone, Search, ChevronLeft, Smartphone, User
} from 'lucide-react';

const BRAND_NAME = "Support Official";
const SESSION_KEY = "support_session_id";
const NAME_KEY = "support_visitor_name";
const PHONE_KEY = "support_visitor_phone";
const NOTICE_KEY = "support_push_notice_dismissed";
const PUSH_PERM_KEY = "support_push_enabled";



export const CustomerChatPortal: React.FC = () => {
  const {
    customerSession,
    customerConversation,
    setCustomerSession,
    messages,
    fetchMessages,
    addMessage,
    markAllMessagesRead,
    typingState,
    theme,
    toggleTheme
  } = useChatStore();

  // State
  const [text, setText] = useState('');
  const [visitorName, setVisitorName] = useState(localStorage.getItem(NAME_KEY) || '');
  const [visitorPhone, setVisitorPhone] = useState(localStorage.getItem(PHONE_KEY) || '');
  
  // UI Panels / Modals
  const [showMenu, setShowMenu] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [pushNoticeVisible, setPushNoticeVisible] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(localStorage.getItem(PUSH_PERM_KEY) === 'true');
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const [showGetIdModal, setShowGetIdModal] = useState(false);
  const [promptNameInput, setPromptNameInput] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Connection & Presence state
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'reconnecting' | 'disconnected'>('connecting');
  const [isAgentOnline, setIsAgentOnline] = useState(false);

  // Session Init Promise Ref
  const initPromiseRef = useRef<Promise<any> | null>(null);

  // PWA install prompt ref
  const deferredPromptRef = useRef<any>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);

  // Refs
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  const isTypingRef = useRef(false);
  const socket = getSocket();


  useEffect(() => {
    const syncViewport = () => {
      const vv = window.visualViewport;
      if (vv) {
        // Height = visible area above keyboard
        document.documentElement.style.setProperty('--app-h', `${vv.height}px`);
        // Offset = how much the viewport has shifted (iOS keyboard push)
        document.documentElement.style.setProperty('--app-offset-top', `${vv.offsetTop}px`);
        document.documentElement.style.setProperty('--app-offset-left', `${vv.offsetLeft}px`);
      } else {
        document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
        document.documentElement.style.setProperty('--app-offset-top', '0px');
        document.documentElement.style.setProperty('--app-offset-left', '0px');
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport);
      window.visualViewport.addEventListener('scroll', syncViewport);
    }
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', () => setTimeout(syncViewport, 250));
    syncViewport();

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', syncViewport);
        window.visualViewport.removeEventListener('scroll', syncViewport);
      }
      window.removeEventListener('resize', syncViewport);
    };
  }, []);

  // ── 2. Toast Helper ──
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  // ── 3. Init Session (Frictionless Guest / Restored) ──
  useEffect(() => {
    const savedSessionId = localStorage.getItem(SESSION_KEY) || localStorage.getItem('customer_session_id');
    const storedName = localStorage.getItem(NAME_KEY) || localStorage.getItem('customer_name') || '';
    const storedPhone = localStorage.getItem(PHONE_KEY) || localStorage.getItem('customer_phone') || '';

    // Instant 0ms Chat Render: Load cached messages immediately from localStorage
    try {
      const cachedMsgs = localStorage.getItem('support_cached_messages');
      if (cachedMsgs) {
        const parsed = JSON.parse(cachedMsgs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          useChatStore.setState({ messages: parsed });
        }
      }
    } catch (_) {}

    const init = async () => {
      // Fire PageView when React chat component fully mounts (with retry polling for async fbevents.js)
      try { trackPixelPageView(); } catch (_) {}
      try {
        const dataPromise = api.initCustomer({
          sessionId: savedSessionId || undefined,
          name: storedName || undefined,
          phone: storedPhone || undefined,
          isGuest: !storedName
        });
        initPromiseRef.current = dataPromise;

        const data = await dataPromise;

        localStorage.setItem(SESSION_KEY, data.customer.sessionId);
        localStorage.setItem('customer_session_id', data.customer.sessionId);

        if (data.customer.name && !data.customer.name.startsWith('Guest_')) {
          localStorage.setItem(NAME_KEY, data.customer.name);
          localStorage.setItem('customer_name', data.customer.name);
          setVisitorName(data.customer.name);
        } else if (storedName) {
          setVisitorName(storedName);
        }

        if (data.customer.phone) {
          localStorage.setItem(PHONE_KEY, data.customer.phone);
          localStorage.setItem('customer_phone', data.customer.phone);
          setVisitorPhone(data.customer.phone);
        }

        setCustomerSession(data.customer, data.conversation);

        // If messages are returned directly in the single init response, load them instantly
        if (data.messages && Array.isArray(data.messages)) {
          useChatStore.setState({
            messages: data.messages,
            messagesCache: {
              ...useChatStore.getState().messagesCache,
              [data.conversation._id]: data.messages
            }
          });
          try {
            localStorage.setItem('support_cached_messages', JSON.stringify(data.messages));
          } catch (_) {}
        } else {
          await fetchMessages(data.conversation._id);
        }

        socket.emit('join_conversation', {
          conversationId: data.conversation._id,
          role: 'customer',
          userId: data.customer._id
        });

      } catch (err) {
        console.error('Customer init error:', err);
      }
    };

    init();

    // Check notice banner
    const noticeDismissed = localStorage.getItem(NOTICE_KEY) === 'true';
    if (!noticeDismissed && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      setPushNoticeVisible(true);
    }
  }, []);

  // ── 3b. PWA Install Prompt Listener ──
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e;
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  // ── 4. Socket Listeners ──
  useEffect(() => {
    const handleReceive = (msg: Message) => {
      addMessage(msg);
      sounds.playReceived();
      if (customerConversation) {
        socket.emit('mark_read', { conversationId: customerConversation._id, readerType: 'customer' });
      }
      // Check if user is scrolled up
      if (messagesContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
        if (scrollHeight - scrollTop - clientHeight > 100) {
          setShowScrollDown(true);
          setUnreadCount((prev) => prev + 1);
        }
      }
    };

    const handleReadAck = ({ conversationId }: { conversationId: string }) => {
      markAllMessagesRead(conversationId);
    };

    const handleStatusUpdate = ({ messageId, status }: { messageId: string; status: any }) => {
      useChatStore.setState((state) => ({
        messages: state.messages.map((m) => (m._id === messageId ? { ...m, status } : m))
      }));
    };

    const handleTyping = ({ conversationId, senderName, senderType, isTyping }: any) => {
      useChatStore.getState().setTyping(conversationId, senderName, isTyping, senderType);
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
  }, [socket, customerConversation]);

  // Re-join on socket reconnect & presence listener
  useEffect(() => {
    const handleConnect = () => {
      setConnectionStatus('connected');
      if (customerSession?._id && customerConversation?._id) {
        socket.emit('join_conversation', {
          conversationId: customerConversation._id,
          role: 'customer',
          userId: customerSession._id
        });
        socket.emit('mark_read', { conversationId: customerConversation._id, readerType: 'customer' });
      }
    };

    const handleDisconnect = () => {
      setConnectionStatus('reconnecting');
    };

    const handleConnectError = () => {
      setConnectionStatus('reconnecting');
    };

    const handleAgentPresence = ({ status, onlineCount }: { status: string; onlineCount: number }) => {
      setIsAgentOnline(onlineCount > 0 || status === 'online');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('agent_presence', handleAgentPresence);

    if (socket.connected) {
      handleConnect();
    } else {
      setConnectionStatus('connecting');
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('agent_presence', handleAgentPresence);
    };
  }, [socket, customerSession?._id, customerConversation?._id]);

  // Scroll to bottom helper
  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    setShowScrollDown(false);
    setUnreadCount(0);
  };

  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length]);

  // Scroll listener for jump to bottom button
  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    if (scrollHeight - scrollTop - clientHeight > 150) {
      setShowScrollDown(true);
    } else {
      setShowScrollDown(false);
      setUnreadCount(0);
    }
  };

  // ── 5. Typing Handlers ──
  const handleTypingStart = () => {
    if (!customerConversation || !customerSession) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing_start', {
        conversationId: customerConversation._id,
        senderName: visitorName || 'Visitor',
        senderType: 'customer'
      });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(handleTypingStop, 2500);
  };

  const handleTypingStop = () => {
    if (!customerConversation) return;
    if (isTypingRef.current) {
      isTypingRef.current = false;
      socket.emit('typing_stop', {
        conversationId: customerConversation._id,
        senderType: 'customer'
      });
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  // ── 6. Send Text Message (Instant 0ms) ──
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim()) return;

    let content = text.trim();
    let currentName = visitorName;

    // Requirement 4: If visitor name not yet registered or guest, register name and ensure "I need id" is attached
    if (!currentName || currentName.startsWith('Guest_') || localStorage.getItem('support_id_registered') !== 'true') {
      const parsedName = content.split('\n')[0].replace(/i need id/gi, '').trim() || content;
      currentName = parsedName;
      setVisitorName(parsedName);
      localStorage.setItem(NAME_KEY, parsedName);
      localStorage.setItem('customer_name', parsedName);
      localStorage.setItem('support_id_registered', 'true');

      if (!content.toLowerCase().includes('i need id')) {
        content = `${content}\nI need id`;
      }
    }

    setText('');
    handleTypingStop();

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Ensure session is ready (await initPromiseRef so first click is never dropped)
    let conv = customerConversation;
    let sess = customerSession;

    if (!conv || !sess) {
      if (initPromiseRef.current) {
        try {
          const initData = await initPromiseRef.current;
          conv = initData.conversation;
          sess = initData.customer;
        } catch (err) {
          console.error('Init wait error in sendMessage:', err);
        }
      }
    }

    if (!conv || !sess) {
      try {
        const savedSessionId = localStorage.getItem(SESSION_KEY) || localStorage.getItem('customer_session_id');
        const initData = await api.initCustomer({
          sessionId: savedSessionId || undefined,
          name: currentName || undefined,
          isGuest: false
        });
        conv = initData.conversation;
        sess = initData.customer;
        setCustomerSession(sess, conv);
      } catch (err) {
        console.error('Direct init error in sendMessage:', err);
      }
    }

    if (!conv || !sess) return;

    // 1. Instant Optimistic Render (<1ms)
    const tempId = 'temp_' + Date.now() + Math.random().toString(36).substring(2, 6);
    const optimisticMsg: Message = {
      _id: tempId,
      conversation: conv._id,
      senderType: 'customer',
      senderId: sess._id,
      senderName: currentName || sess.name || 'Visitor',
      content,
      type: 'text',
      status: 'sent',
      createdAt: new Date().toISOString()
    };

    addMessage(optimisticMsg);
    sounds.playSent();
    scrollToBottom();

    // 2. Instant WebSocket Broadcast (~10ms)
    socket.emit('send_message', optimisticMsg);

    // 3. Background DB Save
    try {
      if (currentName && (!sess.name || sess.name.startsWith('Guest_'))) {
        api.initCustomer({
          sessionId: sess.sessionId,
          name: currentName,
          isGuest: false
        }).then((res) => {
          setCustomerSession(res.customer, res.conversation);
        }).catch((err) => console.error('Error updating customer name:', err));
      }

      const serverMsg = await api.sendMessage({
        conversationId: conv._id,
        senderType: 'customer',
        senderId: sess._id,
        senderName: currentName || sess.name || 'Visitor',
        content,
        type: 'text'
      });

      addMessage(serverMsg);
    } catch (err) {
      console.error('Send error:', err);
    }
  };

  // ── 6b. Name Prompt Submission Handler (Instant 0ms, Zero Drops) ──
  const handleNameSubmit = async (enteredName: string) => {
    if (!enteredName || !enteredName.trim()) return;
    const cleanName = enteredName.trim();

    // 1. Immediately update state so card vanishes 0ms instantly and input updates
    setVisitorName(cleanName);
    localStorage.setItem(NAME_KEY, cleanName);
    localStorage.setItem('customer_name', cleanName);
    localStorage.setItem('support_id_registered', 'true');
    setPromptNameInput('');

    // Fire Lead pixel event on Get ID card submission
    trackPixelLead({ source: 'get_id_card', name: cleanName });

    const messageContent = `${cleanName}\nI need id`;

    // 2. Ensure session is ready (await initPromiseRef so first click is never dropped)
    let conv = customerConversation;
    let sess = customerSession;

    if (!conv || !sess) {
      if (initPromiseRef.current) {
        try {
          const initData = await initPromiseRef.current;
          conv = initData.conversation;
          sess = initData.customer;
        } catch (err) {
          console.error('Init wait error in handleNameSubmit:', err);
        }
      }
    }

    if (!conv || !sess) {
      try {
        const savedSessionId = localStorage.getItem(SESSION_KEY) || localStorage.getItem('customer_session_id');
        const initData = await api.initCustomer({
          sessionId: savedSessionId || undefined,
          name: cleanName,
          isGuest: false
        });
        conv = initData.conversation;
        sess = initData.customer;
        setCustomerSession(sess, conv);
      } catch (err) {
        console.error('Direct init error in handleNameSubmit:', err);
      }
    }

    if (!conv || !sess) return;

    // 3. Instant Optimistic Render (<1ms)
    const tempId = 'temp_' + Date.now() + Math.random().toString(36).substring(2, 6);
    const optimisticMsg: Message = {
      _id: tempId,
      conversation: conv._id,
      senderType: 'customer',
      senderId: sess._id,
      senderName: cleanName,
      content: messageContent,
      type: 'text',
      status: 'sent',
      createdAt: new Date().toISOString()
    };

    addMessage(optimisticMsg);
    sounds.playSent();
    scrollToBottom();

    socket.emit('send_message', optimisticMsg);

    try {
      api.initCustomer({
        sessionId: sess.sessionId,
        name: cleanName,
        isGuest: false
      }).then((res) => {
        setCustomerSession(res.customer, res.conversation);
      }).catch((err) => console.error('Error updating customer name:', err));

      const serverMsg = await api.sendMessage({
        conversationId: conv._id,
        senderType: 'customer',
        senderId: sess._id,
        senderName: cleanName,
        content: messageContent,
        type: 'text'
      });

      addMessage(serverMsg);
    } catch (err) {
      console.error('Name submit error:', err);
    }
  };

  // ── 6c. Quick Action Handler (Instant 0ms) ──
  const handleQuickSend = async (quickText: string) => {
    if (quickText.includes('Get ID') || quickText.includes('I need id')) {
      trackPixelLead({ source: 'quick_action_get_id' });
      if (!visitorName || visitorName.startsWith('Guest_') || !visitorPhone || localStorage.getItem('support_id_registered') !== 'true') {
        setShowGetIdModal(true);
        return;
      }
    }

    if (!quickText.trim() || !customerConversation || !customerSession) return;

    const tempId = 'temp_' + Date.now() + Math.random().toString(36).substring(2, 6);
    const optimisticMsg: Message = {
      _id: tempId,
      conversation: customerConversation._id,
      senderType: 'customer',
      senderId: customerSession._id,
      senderName: visitorName || customerSession.name || 'Visitor',
      content: quickText.trim(),
      type: 'text',
      status: 'sent',
      createdAt: new Date().toISOString()
    };

    addMessage(optimisticMsg);
    sounds.playSent();
    scrollToBottom();

    socket.emit('send_message', optimisticMsg);

    try {
      const serverMsg = await api.sendMessage({
        conversationId: customerConversation._id,
        senderType: 'customer',
        senderId: customerSession._id,
        senderName: visitorName || customerSession.name || 'Visitor',
        content: quickText.trim(),
        type: 'text'
      });

      addMessage(serverMsg);
    } catch (err) {
      console.error('Quick send error:', err);
    }
  };

  // ── 6d. Get ID Modal Submission ──
  const handleSubmitGetId = async (submittedName: string, submittedPhone: string) => {
    trackPixelLead({
      source: 'get_id_modal_submit',
      name: submittedName,
      phone: submittedPhone
    });

    localStorage.setItem(NAME_KEY, submittedName);
    localStorage.setItem('customer_name', submittedName);
    localStorage.setItem(PHONE_KEY, submittedPhone);
    localStorage.setItem('customer_phone', submittedPhone);
    localStorage.setItem('support_id_registered', 'true');

    setVisitorName(submittedName);
    setVisitorPhone(submittedPhone);

    const savedSessionId = localStorage.getItem(SESSION_KEY) || localStorage.getItem('customer_session_id');

    try {
      const data = await api.initCustomer({
        sessionId: savedSessionId || undefined,
        name: submittedName,
        phone: submittedPhone,
        isGuest: false
      });

      setCustomerSession(data.customer, data.conversation);
      setShowGetIdModal(false);

      // Automatically send the ID request message into chat with "I need id"
      await handleQuickSend(`${submittedName}\nI need id\n📱 WhatsApp: ${submittedPhone}`);
      showToast('ID Request Sent!');
    } catch (err) {
      console.error('Error submitting ID:', err);
      setShowGetIdModal(false);
      await handleQuickSend(`${submittedName}\nI need id\n📱 WhatsApp: ${submittedPhone}`);
    }
  };

  // ── 7. Voice Recording ──
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new (window as any).MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event: any) => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordDuration(0);

      recordTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
      showToast('Microphone permission required');
    }
  };

  const stopAndSendVoiceRecording = async () => {
    if (!mediaRecorderRef.current || !customerConversation || !customerSession) return;

    clearInterval(recordTimerRef.current);
    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const file = new (window as any).File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });

      try {
        const uploadRes = await api.uploadFile(file);
        const newMsg = await api.sendMessage({
          conversationId: customerConversation._id,
          senderType: 'customer',
          senderId: customerSession._id,
          senderName: visitorName || customerSession.name || 'Visitor',
          content: '🎤 Voice message',
          fileUrl: uploadRes.fileUrl,
          fileName: uploadRes.fileName,
          type: 'audio'
        });
        addMessage(newMsg);
        sounds.playSent();
        scrollToBottom();
      } catch (err) {
        console.error('Voice send error:', err);
        showToast('Failed to send voice note');
      }

      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setRecordDuration(0);
    };

    mediaRecorderRef.current.stop();
  };

  const cancelVoiceRecording = () => {
    if (mediaRecorderRef.current) {
      clearInterval(recordTimerRef.current);
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    setIsRecording(false);
    setRecordDuration(0);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // ── 8. File Upload Handler ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, _hintType?: MessageType | 'auto') => {
    const file = e.target.files?.[0];
    if (!file || !customerConversation || !customerSession) return;
    setShowAttachSheet(false);

    try {
      showToast('Uploading…');
      const uploadRes = await api.uploadFile(file);

      // Accurately resolve file type: images are always 'image', never 'document'
      let resolvedType: MessageType = 'document';
      const mime = (file.type || uploadRes.mimeType || '').toLowerCase();
      const ext = (file.name || '').toLowerCase();
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic', '.heif', '.avif', '.ico'];
      const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp'];
      const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];

      if (mime.startsWith('image/') || imageExts.some(e => ext.endsWith(e)) || uploadRes.type === 'image') {
        resolvedType = 'image';
      } else if (mime.startsWith('video/') || videoExts.some(e => ext.endsWith(e)) || uploadRes.type === 'video') {
        resolvedType = 'video';
      } else if (mime.startsWith('audio/') || audioExts.some(e => ext.endsWith(e)) || uploadRes.type === 'audio') {
        resolvedType = 'audio';
      } else if (mime === 'application/pdf' || ext.endsWith('.pdf') || uploadRes.type === 'pdf') {
        resolvedType = 'pdf';
      }

      const newMsg = await api.sendMessage({
        conversationId: customerConversation._id,
        senderType: 'customer',
        senderId: customerSession._id,
        senderName: visitorName || customerSession.name || 'Visitor',
        content: file.name,
        fileUrl: uploadRes.fileUrl,
        fileName: file.name,
        fileSize: file.size,
        type: resolvedType
      });
      addMessage(newMsg);
      sounds.playSent();
      scrollToBottom();
    } catch (err) {
      console.error('File upload error:', err);
      showToast('File upload failed');
    } finally {
      e.target.value = '';
    }
  };

  // ── 9. Menu & Settings Handlers ──
  const handleInstallPwa = async () => {
    setShowMenu(false);
    const res = await installPwaApp();
    if (res.message) {
      showToast(res.message);
    }
  };

  const handleEnablePush = async () => {
    if (typeof Notification !== 'undefined') {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          setPushEnabled(true);
          localStorage.setItem(PUSH_PERM_KEY, 'true');
          setPushNoticeVisible(false);
          showToast('Notifications enabled!');
        } else {
          showToast('Notification permission denied');
        }
      } catch (err) {
        console.error('Push error:', err);
      }
    }
  };

  const handleClearChat = () => {
    setShowMenu(false);
    if (confirm('Clear chat history on this device?')) {
      useChatStore.setState({ messages: [] });
      showToast('Chat cleared locally');
    }
  };

  // Helper date formatter for Day Dividers
  const formatDayDivider = (isoDate: string) => {
    const d = new Date(isoDate);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };

  const isAgentTyping = customerConversation && typingState[customerConversation._id]?.senderType === 'agent' && typingState[customerConversation._id]?.isTyping;

  // Filter out any system welcome greeting (e.g. "Welcome to our Live Support, Guest_...")
  const validMessages = messages.filter((m) => {
    if (m.senderType === 'system' || (m.content && m.content.includes('Welcome to our Live Support'))) {
      return false;
    }
    return true;
  });

  // Sort messages: Initial Name Prompt is 1st, User message is 2nd, Welcome Card is 3rd
  const sortedMessages = [...validMessages].sort((a, b) => {
    const aIsPrompt = a.senderId === 'agent_auto_prompt' || a.senderId === 'agent_auto_prompt2' || (a.content && (a.content.includes('Please enter your name') || a.content.includes('Please share your name and number')));
    const bIsPrompt = b.senderId === 'agent_auto_prompt' || b.senderId === 'agent_auto_prompt2' || (b.content && (b.content.includes('Please enter your name') || b.content.includes('Please share your name and number')));

    if (aIsPrompt && !bIsPrompt) return -1;
    if (!aIsPrompt && bIsPrompt) return 1;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const deduplicatedMessages: Message[] = [];
  const seenMsgIds = new Set<string>();

  for (const m of sortedMessages) {
    const isWelcome = m.senderId === 'agent_auto_welcome' || (m.content && (m.content.includes('SUPREME') || m.content.includes('DlAM0ND') || m.content.includes('allpanelexch9') || m.content.includes('DIAMOND')));
    const isPrompt1 = m.senderId === 'agent_auto_prompt' || (m.content && m.content.includes('Please enter your name') && !m.content.includes('number'));
    const isPrompt2 = m.senderId === 'agent_auto_prompt2' || (m.content && m.content.includes('Please share your name and number'));

    let msgKey = m._id || `${m.senderId}_${m.content}`;
    if (isWelcome) {
      msgKey = 'unique_auto_welcome';
    } else if (isPrompt1) {
      msgKey = 'unique_auto_prompt1';
    } else if (isPrompt2) {
      msgKey = 'unique_auto_prompt2';
    }

    if (!seenMsgIds.has(msgKey)) {
      seenMsgIds.add(msgKey);
      deduplicatedMessages.push(m);
    }
  }

  const filteredMessages = deduplicatedMessages.filter((m) => {
    // Hide auto-prompt messages (name/number request bubbles) from chat
    const isAutoPrompt =
      m.senderId === 'agent_auto_prompt' ||
      m.senderId === 'agent_auto_prompt2' ||
      (m.content && m.content.includes('Please enter your name for Id')) ||
      (m.content && m.content.includes('Please share your name and number'));
    if (isAutoPrompt) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (m.content && m.content.toLowerCase().includes(q)) ||
      (m.senderName && m.senderName.toLowerCase().includes(q)) ||
      (m.fileName && m.fileName.toLowerCase().includes(q))
    );
  });

  const hasCustomerMessage = messages.some((m) => m.senderType === 'customer');
  const hasRegisteredName = Boolean(
    (visitorName && !visitorName.startsWith('Guest_')) ||
    localStorage.getItem('support_id_registered') === 'true' ||
    hasCustomerMessage
  );

  return (
    <div
      className="fixed w-full flex flex-col bg-[#efeae2] dark:bg-[#0b141a] select-none overflow-hidden"
      style={{
        top: 'var(--app-offset-top, 0px)',
        left: 'var(--app-offset-left, 0px)',
        height: 'var(--app-h, 100dvh)',
        maxHeight: 'var(--app-h, 100dvh)',
      }}
    >
      
      {/* ═══════════════ HEADER ═══════════════ */}
      <header className="px-3 bg-[#075e54] dark:bg-[#1f2c33] text-white flex items-center justify-between z-30 shadow-sm shrink-0 pt-[env(safe-area-inset-top,0px)] h-[calc(56px+env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-[40px] h-[40px] rounded-full overflow-hidden shrink-0 shadow-md border-2 border-white/30 bg-emerald-700 flex items-center justify-center">
            <img
              src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80"
              alt="Support Official"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = 'none';
              }}
            />
            <span className="absolute text-sm font-bold text-white uppercase select-none -z-10">S</span>
            <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-2 border-[#075e54] dark:border-[#1f2c33] rounded-full transition-colors ${
              connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
                ? 'bg-amber-400 animate-pulse'
                : isAgentTyping || isAgentOnline
                  ? 'bg-emerald-400'
                  : 'bg-gray-400'
            }`} />
          </div>
          <div className="min-w-0 flex flex-col justify-center">
            <h1 className="text-[15px] font-semibold tracking-tight truncate leading-tight flex items-center gap-1.5">
              <span>{BRAND_NAME}</span>
            </h1>
            <p className="text-[11px] leading-tight">
              {connectionStatus === 'connecting' ? (
                <span className="text-amber-200 animate-pulse font-medium">Connecting…</span>
              ) : connectionStatus === 'reconnecting' || connectionStatus === 'disconnected' ? (
                <span className="text-amber-200 animate-pulse font-medium">Reconnecting…</span>
              ) : isAgentTyping ? (
                <span className="font-semibold italic text-amber-200 animate-pulse">typing…</span>
              ) : isAgentOnline ? (
                <span className="text-emerald-200 dark:text-emerald-400 font-medium">Online</span>
              ) : (
                <span className="text-white/70 dark:text-white/60">Offline</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Notification Bell */}
          <button
            onClick={() => setShowNotifPanel(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 active:bg-white/20 transition-all relative"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
          </button>

          {/* Voice Call Button */}
          <button
            onClick={() => setShowVoiceCall(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 active:bg-white/20 transition-all"
            aria-label="Voice Call"
          >
            <Phone className="w-4 h-4" />
          </button>

          {/* Search Toggle */}
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              showSearch ? 'bg-black/20 text-amber-300' : 'text-white/90 hover:bg-white/10'
            }`}
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* 3-Dots Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 active:bg-white/20 transition-all"
              aria-label="More options"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {/* Menu Popover */}
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-12 w-60 bg-white dark:bg-[#202c33] rounded-xl shadow-2xl py-1.5 z-50 text-[#111b21] dark:text-[#e9edef] border border-black/[0.06] dark:border-white/[0.08] animate-pop text-sm font-normal">
                  <button
                    onClick={handleInstallPwa}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] transition-colors flex items-center justify-between"
                  >
                    <span>Add to Home screen</span>
                    <Smartphone className="w-4 h-4 text-[#00a884]" />
                  </button>
                  <button
                    onClick={() => { setShowMenu(false); setShowNotifPanel(true); }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] transition-colors"
                  >
                    Notification settings
                  </button>
                  <button
                    onClick={() => { toggleTheme(); setShowMenu(false); }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#f0f2f5] dark:hover:bg-[#111b21] transition-colors flex items-center justify-between"
                  >
                    <span>{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
                    {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
                  </button>
                  <div className="h-[1px] bg-black/[0.06] dark:bg-white/[0.08] my-1" />
                  <button
                    onClick={handleClearChat}
                    className="w-full px-4 py-2.5 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    Clear chat on this device
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════════ STICKY NOTIFICATION PROMPT ═══════════════ */}
      {pushNoticeVisible && (
        <div className="bg-[#182229] text-white px-3 py-2 text-xs flex items-center justify-between gap-2 shadow-md z-20 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-[#25d366] shrink-0" />
            <span className="truncate">Turn on notifications so you don't miss our reply</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleEnablePush}
              className="bg-[#25d366] hover:bg-[#1da851] text-[#05231b] font-semibold px-2.5 py-1 rounded-md text-[11px] transition-colors"
            >
              Turn on
            </button>
            <button
              onClick={() => {
                setPushNoticeVisible(false);
                localStorage.setItem(NOTICE_KEY, 'true');
              }}
              className="text-white/60 hover:text-white p-0.5"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ SEARCH & EXPORT DRAWER ═══════════════ */}
      {showSearch && (
        <div className="bg-white dark:bg-[#111b21] px-3 py-2 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-2 z-20 shadow-sm animate-in slide-in-from-top-1">
          <div className="flex-1 flex items-center gap-2 bg-[#f0f2f5] dark:bg-[#202c33] px-3 py-1.5 rounded-lg">
            <Search className="w-3.5 h-3.5 text-[#8696a0]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in chat…"
              className="w-full bg-transparent text-xs text-[#111b21] dark:text-[#e9edef] outline-none"
              autoFocus
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-[#8696a0] hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => exportChatAsTxt(filteredMessages, 'Chat_Export')}
              className="p-1.5 bg-[#00a884]/15 hover:bg-[#00a884]/25 text-[#00a884] dark:text-emerald-400 rounded-lg text-xs font-semibold flex items-center gap-1"
              title="Export TXT"
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => exportChatAsPdf(filteredMessages, 'Chat_Export')}
              className="p-1.5 bg-[#00a884] hover:bg-[#008f70] text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm"
              title="Export PDF"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ CONVERSATION BODY ═══════════════ */}
      <main
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-3 md:px-6 space-y-2 chat-wallpaper relative"
      >
        {/* In-chat Interactive Name for ID Card (Shown to any new visitor who hasn't registered name yet) */}
        {!hasRegisteredName && (
          <div className="mx-auto max-w-sm my-3 p-4 rounded-2xl bg-white/95 dark:bg-[#202c33]/95 shadow-lg border border-[#00a884]/40 text-center animate-in fade-in zoom-in-95 backdrop-blur-md">
            <div className="w-12 h-12 rounded-full bg-[#00a884]/15 text-[#00a884] dark:text-emerald-400 mx-auto flex items-center justify-center mb-2.5 shadow-xs">
              <User className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef] tracking-tight mb-3">
              Hello! Please enter your name for ID
            </h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (promptNameInput.trim()) {
                const name = promptNameInput.trim();
                handleNameSubmit(name);
              }
            }} className="flex gap-2">
              <input
                name="promptName"
                type="text"
                value={promptNameInput}
                onChange={(e) => setPromptNameInput(e.target.value)}
                required
                placeholder="Enter your name..."
                className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm bg-[#f0f2f5] dark:bg-[#111b21] rounded-xl outline-none border border-black/10 dark:border-white/10 focus:border-[#00a884] text-[#111b21] dark:text-[#e9edef] font-normal"
                autoFocus
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-[#00a884] hover:bg-[#008f70] text-white text-xs sm:text-sm font-bold shadow-xs active:scale-95 transition-all cursor-pointer whitespace-nowrap"
              >
                Get ID
              </button>
            </form>
          </div>
        )}

        {/* Message List with Day Dividers */}
        {filteredMessages.map((msg, index) => {
          const prevMsg = filteredMessages[index - 1];
          const isNewDay = !prevMsg || new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

          return (
            <React.Fragment key={msg._id || index}>
              {isNewDay && (
                <div className="flex justify-center my-3">
                  <span className="bg-white/90 dark:bg-[#182229]/90 text-[#667781] dark:text-[#8696a0] text-[11px] font-semibold px-3 py-1 rounded-lg shadow-xs backdrop-blur-md uppercase tracking-wider">
                    {formatDayDivider(msg.createdAt)}
                  </span>
                </div>
              )}
              <MessageBubble
                message={msg}
                currentUserId={customerSession?._id}
                isAgentView={false}
              />
            </React.Fragment>
          );
        })}

        <div ref={messagesEndRef} />
      </main>

      {/* Floating Scroll-to-Bottom Button */}
      {showScrollDown && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-24 right-4 w-10 h-10 rounded-full bg-white dark:bg-[#202c33] text-[#667781] dark:text-[#8696a0] shadow-lg flex items-center justify-center z-20 border border-black/[0.08] dark:border-white/[0.08] transition-all hover:scale-105 active:scale-95 cursor-pointer"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-[#25d366] text-[#05231b] font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center shadow-xs">
              {unreadCount}
            </span>
          )}
        </button>
      )}

      {/* ═══════════════ COMPOSER & INPUT BAR ═══════════════ */}
      <footer className="bg-[#f0f2f5] dark:bg-[#202c33] px-2 py-1.5 pb-[max(0.6rem,env(safe-area-inset-bottom,0px))] pl-[max(0.5rem,env(safe-area-inset-left,0px))] pr-[max(0.5rem,env(safe-area-inset-right,0px))] border-t border-black/[0.06] dark:border-white/[0.08] z-30 shrink-0">
        {/* Quick Action Chips */}
        <div className="px-1 pb-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => handleQuickSend('I need id')}
            className="flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-[#00a884] hover:bg-[#008f70] text-white text-xs font-bold shadow-xs active:scale-95 transition-all whitespace-nowrap cursor-pointer"
          >
            <span>🔥 Get ID Now</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickSend('Deposit')}
            className="flex items-center gap-1 px-3 py-1 rounded-full bg-white dark:bg-[#2a3942] hover:bg-[#e9edef] dark:hover:bg-[#32444d] text-[#111b21] dark:text-[#e9edef] text-xs font-medium border border-black/[0.06] dark:border-white/[0.08] shadow-xs active:scale-95 transition-all whitespace-nowrap cursor-pointer"
          >
            <span>⚡ Deposit</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickSend('Withdrawal')}
            className="flex items-center gap-1 px-3 py-1 rounded-full bg-white dark:bg-[#2a3942] hover:bg-[#e9edef] dark:hover:bg-[#32444d] text-[#111b21] dark:text-[#e9edef] text-xs font-medium border border-black/[0.06] dark:border-white/[0.08] shadow-xs active:scale-95 transition-all whitespace-nowrap cursor-pointer"
          >
            <span>💸 Withdrawal</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickSend('Customer Support')}
            className="flex items-center gap-1 px-3 py-1 rounded-full bg-white dark:bg-[#2a3942] hover:bg-[#e9edef] dark:hover:bg-[#32444d] text-[#111b21] dark:text-[#e9edef] text-xs font-medium border border-black/[0.06] dark:border-white/[0.08] shadow-xs active:scale-95 transition-all whitespace-nowrap cursor-pointer"
          >
            <span>💬 Support</span>
          </button>
        </div>

        {isRecording ? (
          /* Live Voice Recording Bar */
          <div className="flex items-center gap-3 px-2 py-1 bg-white dark:bg-[#111b21] rounded-2xl border border-black/[0.06] dark:border-white/[0.08] shadow-sm animate-pop">
            <button
              onClick={cancelVoiceRecording}
              className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-full transition-colors cursor-pointer"
              title="Cancel recording"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-rec-dot" />
            <span className="text-xs font-semibold text-red-500 font-mono">
              {formatDuration(recordDuration)}
            </span>
            <span className="text-xs text-[#667781] dark:text-[#8696a0] flex-1 truncate">
              Recording — tap send when done
            </span>
            <button
              onClick={stopAndSendVoiceRecording}
              className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#008f70] text-white flex items-center justify-center shadow-md active:scale-95 transition-all cursor-pointer"
              title="Send audio"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Standard WhatsApp Composer */
          <div className="flex items-center gap-1.5">
            {/* Emoji Button */}
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className={`p-2 rounded-full transition-colors cursor-pointer ${
                showEmojiPicker ? 'text-[#00a884] bg-emerald-50 dark:bg-emerald-950/30' : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
              }`}
              title="Emoji"
            >
              <Smile className="w-6 h-6" />
            </button>

            {/* Attachments Sheet Trigger */}
            <button
              onClick={() => setShowAttachSheet(true)}
              className="p-2 text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white rounded-full transition-colors cursor-pointer"
              title="Attach"
            >
              <Paperclip className="w-5 h-5 -rotate-45" />
            </button>

            {/* Text Input */}
            <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-2xl px-3.5 py-2 flex items-center border border-black/[0.04] dark:border-white/[0.04] shadow-xs">
              <textarea
                ref={textareaRef}
                rows={1}
                value={text}
                onFocus={() => {
                  setTimeout(() => {
                    scrollToBottom();
                  }, 300);
                }}
                onChange={(e) => {
                  setText(e.target.value);
                  handleTypingStart();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Message"
                className="w-full bg-transparent text-sm sm:text-base text-[#111b21] dark:text-[#e9edef] placeholder-[#8696a0] outline-none resize-none max-h-24 leading-5"
              />
            </div>

            {/* Mic or Send Button */}
            {text.trim() ? (
              <button
                onClick={() => handleSendMessage()}
                className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#008f70] text-white flex items-center justify-center shadow-md active:scale-95 transition-all shrink-0 cursor-pointer"
                title="Send message"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            ) : (
              <button
                onClick={startVoiceRecording}
                className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#008f70] text-white flex items-center justify-center shadow-md active:scale-95 transition-all shrink-0 cursor-pointer"
                title="Record voice message"
              >
                <Mic className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </footer>

      {/* ═══════════════ HIDDEN FILE INPUTS ═══════════════ */}
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => handleFileUpload(e, 'auto')}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => handleFileUpload(e, 'image')}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => handleFileUpload(e, 'audio')}
      />

      {/* ═══════════════ ATTACHMENT BOTTOM SHEET ═══════════════ */}
      {showAttachSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setShowAttachSheet(false)} />
          <div className="w-full max-w-lg bg-white dark:bg-[#202c33] rounded-t-3xl p-6 z-50 border-t border-black/[0.06] dark:border-white/[0.08] shadow-2xl animate-sheet">
            <div className="w-12 h-1 bg-black/20 dark:bg-white/20 rounded-full mx-auto mb-6" />
            <div className="grid grid-cols-4 gap-4 text-center">
              {/* Gallery */}
              <button
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = 'image/*,video/*';
                    fileInputRef.current.click();
                  }
                }}
                className="flex flex-col items-center gap-2 group active:scale-95 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-white flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                  <ImageIcon className="w-6 h-6" />
                </div>
                <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">Gallery</span>
              </button>

              {/* Camera */}
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-col items-center gap-2 group active:scale-95 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-500 to-pink-500 text-white flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                  <Camera className="w-6 h-6" />
                </div>
                <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">Camera</span>
              </button>

              {/* Document */}
              <button
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = '*/*';
                    fileInputRef.current.click();
                  }
                }}
                className="flex flex-col items-center gap-2 group active:scale-95 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-500 to-cyan-500 text-white flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                  <File className="w-6 h-6" />
                </div>
                <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">Document</span>
              </button>

              {/* Audio */}
              <button
                onClick={() => audioInputRef.current?.click()}
                className="flex flex-col items-center gap-2 group active:scale-95 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                  <Music className="w-6 h-6" />
                </div>
                <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">Audio</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ NOTIFICATION CENTRE DRAWER ═══════════════ */}
      {showNotifPanel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setShowNotifPanel(false)} />
          <div className="w-full max-w-sm bg-white dark:bg-[#111b21] h-full z-50 flex flex-col shadow-2xl border-l border-black/[0.06] dark:border-white/[0.08] animate-drawer">
            {/* Header */}
            <header className="h-[56px] px-3 bg-[#075e54] dark:bg-[#1f2c33] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => setShowNotifPanel(false)} className="p-1 rounded-full hover:bg-white/10">
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <h2 className="text-base font-semibold">Notifications</h2>
              </div>
              <button onClick={() => showToast('Notifications cleared')} className="text-xs text-emerald-200 hover:text-white">
                Clear all
              </button>
            </header>

            {/* Push Switch Row */}
            <div className="p-4 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Push notifications</h3>
                <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">
                  Get a phone alert when support replies, even after you close this page.
                </p>
              </div>
              <button
                onClick={handleEnablePush}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${
                  pushEnabled ? 'bg-[#00a884]' : 'bg-black/20 dark:bg-white/20'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform absolute top-0.5 ${
                    pushEnabled ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Notifications List */}
            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-full bg-black/5 dark:bg-white/5 text-[#8696a0] flex items-center justify-center mb-3">
                <Bell className="w-7 h-7" />
              </div>
              <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef]">No notifications yet</p>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1">
                Replies from support will show up here.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ VOICE CALL MODAL ═══════════════ */}
      {showVoiceCall && (
        <VoiceCallModal
          contactName={BRAND_NAME}
          contactImage="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300&auto=format&fit=crop&q=80"
          phoneNumber={visitorPhone || "+91 9876543210"}
          onClose={() => setShowVoiceCall(false)}
        />
      )}

      {/* ═══════════════ EMOJI PICKER MODAL ═══════════════ */}
      {showEmojiPicker && (
        <EmojiPickerModal
          onSelect={(emoji) => {
            setText((prev) => prev + emoji);
            setShowEmojiPicker(false);
          }}
          onClose={() => setShowEmojiPicker(false)}
        />
      )}

      {/* ═══════════════ GET ID MODAL (POPUP) — only when inline card is NOT shown ═══════════════ */}
      <GetIdModal
        isOpen={showGetIdModal && (hasRegisteredName || hasCustomerMessage || messages.length > 1)}
        onSubmit={handleSubmitGetId}
        onClose={() => setShowGetIdModal(false)}
        initialName={visitorName && !visitorName.startsWith('Guest_') ? visitorName : ''}
        initialPhone={visitorPhone || ''}
      />

      {/* ═══════════════ TOAST NOTIFICATION ═══════════════ */}
      {toastMsg && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-[#111b21]/90 text-white text-xs px-4 py-2 rounded-full shadow-2xl z-50 backdrop-blur-md animate-pop">
          {toastMsg}
        </div>
      )}
    </div>
  );
};
