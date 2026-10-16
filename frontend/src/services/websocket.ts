import { io, Socket } from 'socket.io-client';

class WebSocketService {
  private socket: Socket | null = null;
  private subscribers: Map<string, Set<Function>> = new Map();
  private pendingEmits: Array<{ event: string; data?: any }> = [];

  connect() {
    if (this.socket?.connected) return;

    const token = localStorage.getItem('auth_token');
    
    this.socket = io('/', {
      auth: { token },
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      for (const pending of this.pendingEmits) {
        this.socket?.emit(pending.event, pending.data);
      }
      this.pendingEmits = [];
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    this.socket.onAny((event, ...args) => {
      const callbacks = this.subscribers.get(event);
      if (callbacks) {
        callbacks.forEach(cb => cb(...args));
      }
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  subscribe(event: string, callback: Function) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event)!.add(callback);
    return () => this.unsubscribe(event, callback);
  }

  unsubscribe(event: string, callback: Function) {
    const callbacks = this.subscribers.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  emit(event: string, data?: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      this.pendingEmits.push({ event, data });
    }
  }

  subscribeToChannel(channelId: string) {
    this.socket?.emit('subscribe:channel', channelId);
  }

  unsubscribeFromChannel(channelId: string) {
    this.socket?.emit('unsubscribe:channel', channelId);
  }
}

export const wsService = new WebSocketService();
