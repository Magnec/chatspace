(function (Drupal, drupalSettings) {
  'use strict';

  // Mesaj ile ilgili tüm fonksiyonlar
  window.ChatSpaceMessages = {
    lastMessageId: 0,
    messageRefreshRunning: false,
    currentPollingInterval: 300,
    lastMessageTime: Date.now(),
    consecutiveEmptyPolls: 0,
    sendingMessage: false,
    isTabActive: true,
    originalTitle: document.title,
    isNearBottom: true,
    typingUsers: [],

    // Polling sabitleri - INSTANT feeling için optimize
    POLLING_FAST: 300,      // Aktif sohbet - anlık hissi
    POLLING_NORMAL: 500,    // Normal aktivite
    POLLING_SLOW: 1000,     // Yavaş aktivite
    POLLING_IDLE: 2000,     // Boşta durma

    init: function(currentRoomId, makeRequestWithToken, csrfToken) {
      this.currentRoomId = currentRoomId;
      this.makeRequestWithToken = makeRequestWithToken;
      this.csrfToken = csrfToken;
      this.setupScrollDetection();
      this.setupJumpToBottomButton();
    },

    // Auto-scroll - HER ZAMAN en alta kaydır
    scrollToBottom: function(animated) {
      animated = animated === undefined ? true : animated;
      const msgPanel = document.getElementById('chat-messages');
      if (!msgPanel) return;

      setTimeout(function() {
        if (animated) {
          msgPanel.scrollTo({
            top: msgPanel.scrollHeight,
            behavior: 'smooth'
          });
        } else {
          msgPanel.scrollTop = msgPanel.scrollHeight;
        }
      }, 100);
    },

    // YENİ: Scroll detection - jump to bottom button için
    setupScrollDetection: function() {
      const self = this;
      const msgPanel = document.getElementById('chat-messages');
      if (!msgPanel) return;

      msgPanel.addEventListener('scroll', function() {
        const scrollTop = msgPanel.scrollTop;
        const scrollHeight = msgPanel.scrollHeight;
        const clientHeight = msgPanel.clientHeight;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        self.isNearBottom = distanceFromBottom < 100;

        const jumpBtn = document.getElementById('jump-to-bottom');
        if (jumpBtn) {
          if (self.isNearBottom) {
            jumpBtn.classList.remove('visible');
          } else {
            jumpBtn.classList.add('visible');
          }
        }
      });
    },

    // YENİ: Jump to bottom button
    setupJumpToBottomButton: function() {
      const self = this;
      const msgContainer = document.querySelector('.chat-space-messages');
      if (!msgContainer || document.getElementById('jump-to-bottom')) return;

      const button = document.createElement('button');
      button.id = 'jump-to-bottom';
      button.className = 'jump-to-bottom';
      button.innerHTML = '↓';
      button.title = 'En alta git';

      button.addEventListener('click', function() {
        self.scrollToBottom(true);
      });

      msgContainer.appendChild(button);
    },

    // YENİ: Typing indicator göster
    updateTypingIndicator: function(typingUsers) {
      this.typingUsers = typingUsers || [];
      const msgPanel = document.getElementById('chat-messages');
      if (!msgPanel) return;

      // Eski typing indicator'ı kaldır
      const oldIndicator = document.getElementById('typing-indicator');
      if (oldIndicator) {
        oldIndicator.remove();
      }

      // Typing user varsa göster
      if (this.typingUsers.length > 0) {
        const indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';

        let text = '';
        if (this.typingUsers.length === 1) {
          text = this.typingUsers[0].name + ' yazıyor...';
        } else if (this.typingUsers.length === 2) {
          text = this.typingUsers[0].name + ' ve ' + this.typingUsers[1].name + ' yazıyor...';
        } else {
          text = this.typingUsers.length + ' kişi yazıyor...';
        }

        indicator.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>' +
          '<span class="typing-text">' + this.escapeHtml(text) + '</span>';

        msgPanel.appendChild(indicator);

        // Typing varsa scroll yap
        if (this.isNearBottom) {
          this.scrollToBottom(true);
        }
      }
    },

    // YENİ: Tarih karşılaştırma helper
    isSameDay: function(date1, date2) {
      return date1.getFullYear() === date2.getFullYear() &&
             date1.getMonth() === date2.getMonth() &&
             date1.getDate() === date2.getDate();
    },

    // YENİ: Tarih divider metni
    getDateDividerText: function(date) {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (this.isSameDay(date, today)) {
        return 'Bugün';
      } else if (this.isSameDay(date, yesterday)) {
        return 'Dün';
      } else {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return date.toLocaleDateString('tr-TR', options);
      }
    },

    // YENİ: Date divider oluştur
    createDateDivider: function(date) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.innerHTML = '<span>' + this.escapeHtml(this.getDateDividerText(date)) + '</span>';
      return divider;
    },

    renderMessages: function(messages, reset) {
      const self = this;
      reset = reset || false;
      const msgPanel = document.getElementById('chat-messages');
      if (!msgPanel) return;

      if (reset) {
        msgPanel.innerHTML = '';
        this.lastMessageId = 0;
        this.lastRenderedDate = null;
        this.lastRenderedUser = null;
        this.lastRenderedTime = null;
      }

      let hasNewMessages = false;
      let newMessagesFromOthers = false;

      messages.forEach(function(msg, index) {
        if (document.querySelector('[data-message-id="' + msg.message_id + '"]')) {
          return;
        }

        // YENİ: Parse message timestamp (GÜVENLİ - timestamp yoksa özellikleri devre dışı bırak)
        let msgDate = null;
        let shouldGroup = false;

        if (msg.timestamp) {
          msgDate = new Date(msg.timestamp * 1000);

          // YENİ: Date divider ekle (günler arası)
          if (!self.lastRenderedDate || !self.isSameDay(msgDate, self.lastRenderedDate)) {
            const divider = self.createDateDivider(msgDate);
            msgPanel.appendChild(divider);
            self.lastRenderedDate = msgDate;
            self.lastRenderedUser = null; // Yeni gün, user grouping sıfırla
          }

          // YENİ: Message grouping - aynı kullanıcıdan 5 dakika içindeki mesajlar
          shouldGroup = self.lastRenderedUser === msg.uid &&
                        self.lastRenderedTime &&
                        (msg.timestamp - self.lastRenderedTime) < 300; // 5 dakika
        }

        const div = document.createElement('div');
        div.className = 'chat-message-bubble';
        div.dataset.messageId = msg.message_id;
        if (msg.timestamp) {
          div.dataset.timestamp = msg.timestamp;
        }

        const isCurrentUser = msg.uid == drupalSettings.user?.uid;
        const messageClass = isCurrentUser ? 'own-message' : 'other-message';
        div.classList.add(messageClass);

        // YENİ: Grouping class
        if (shouldGroup) {
          div.classList.add('grouped');
        }

        // YENİ: Edit/Delete butonları
        let actionsHtml = '';
        if (msg.can_edit || msg.can_delete) {
          actionsHtml = '<div class="message-actions">';
          if (msg.can_edit) {
            actionsHtml += '<button class="message-action-btn edit-btn" title="Düzenle" onclick="editMessage(' + msg.message_id + ')">✏️</button>';
          }
          if (msg.can_delete) {
            actionsHtml += '<button class="message-action-btn delete-btn" title="Sil" onclick="deleteMessage(' + msg.message_id + ')">🗑️</button>';
          }
          actionsHtml += '</div>';
        }

        // YENİ: Düzenleme göstergesi
        let editedText = '';
        if (msg.is_edited) {
          editedText = '<span class="chat-message-edited">(düzenlendi)</span>';
        }

        // YENİ: Mention'lı mesaj gösterimi - formatted_message varsa onu kullan
        const messageContent = msg.formatted_message || self.formatMessage(msg.message);

        // YENİ: Gruplandırılmış mesajlarda avatar ve meta gizle
        if (shouldGroup) {
          div.innerHTML = '<div class="message-content">' +
            '<div class="chat-message-content" data-original-text="' + self.escapeHtml(msg.message) + '">' +
            '<span class="grouped-time">' + self.escapeHtml(msg.created) + '</span>' +
            messageContent + '</div>' +
            actionsHtml +
            '<div class="message-edit-form" id="edit-form-' + msg.message_id + '">' +
            '<textarea class="message-edit-input" id="edit-input-' + msg.message_id + '">' + self.escapeHtml(msg.message) + '</textarea>' +
            '<div class="message-edit-actions">' +
            '<button class="message-edit-save" onclick="saveEdit(' + msg.message_id + ')">Kaydet</button>' +
            '<button class="message-edit-cancel" onclick="cancelEdit(' + msg.message_id + ')">İptal</button>' +
            '</div>' +
            '</div>' +
            '</div>';
        } else {
          div.innerHTML = '<img class="chat-message-avatar" src="' + self.escapeHtml(msg.avatar) + '" alt="Avatar" />' +
            '<div class="message-content">' +
            '<div class="chat-message-meta">' +
            '<span class="chat-message-name">' + self.escapeHtml(msg.name) + '</span>' +
            '<span class="chat-message-time">' + self.escapeHtml(msg.created) + '</span>' +
            editedText +
            '</div>' +
            '<div class="chat-message-content" data-original-text="' + self.escapeHtml(msg.message) + '">' + messageContent + '</div>' +
            actionsHtml +
            '<div class="message-edit-form" id="edit-form-' + msg.message_id + '">' +
            '<textarea class="message-edit-input" id="edit-input-' + msg.message_id + '">' + self.escapeHtml(msg.message) + '</textarea>' +
            '<div class="message-edit-actions">' +
            '<button class="message-edit-save" onclick="saveEdit(' + msg.message_id + ')">Kaydet</button>' +
            '<button class="message-edit-cancel" onclick="cancelEdit(' + msg.message_id + ')">İptal</button>' +
            '</div>' +
            '</div>' +
            '</div>';
        }

        // YENİ: Fade-in animation
        setTimeout(function() {
          div.classList.add('fade-in');
        }, 10);

        msgPanel.appendChild(div);
        hasNewMessages = true;

        // YENİ: Track last rendered message için (sadece timestamp varsa)
        if (msg.timestamp) {
          self.lastRenderedUser = msg.uid;
          self.lastRenderedTime = msg.timestamp;
        }

        if (msg.message_id > self.lastMessageId) {
          self.lastMessageId = msg.message_id;
          self.lastMessageTime = Date.now();
          if (!isCurrentUser) newMessagesFromOthers = true;
        }

        // YENİ: Mention bildirimi göster
        if (msg.mentions && msg.mentions.length > 0 && !isCurrentUser) {
          const mentionNames = msg.mentions.map(u => u.name).join(', ');
          self.showNotification('Etiketlendiniz: ' + mentionNames, 'info');
        }
      });

      // Yeni mesaj varsa scroll yap - HER ZAMAN
      if (hasNewMessages) {
        this.scrollToBottom(true); // Smooth scroll
        this.adaptPollingSpeed(true);

        if (newMessagesFromOthers) {
          this.playNotificationSound();
          if (!this.isTabActive) {
            document.title = '(Yeni Mesaj) ' + (this.originalTitle || 'Chat');
          }
        }
      }
    },

    adaptPollingSpeed: function(hasNewMessage) {
      hasNewMessage = hasNewMessage || false;
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageTime;
      let newInterval = this.currentPollingInterval;
      if (hasNewMessage) {
        newInterval = this.POLLING_FAST;
        this.consecutiveEmptyPolls = 0;
      } else {
        this.consecutiveEmptyPolls++;
        if (this.consecutiveEmptyPolls > 10) {
          if (timeSinceLastMessage > 30000) {
            newInterval = this.POLLING_IDLE;
          } else if (timeSinceLastMessage > 10000) {
            newInterval = this.POLLING_SLOW;
          } else {
            newInterval = this.POLLING_NORMAL;
          }
        }
      }
      if (!this.isTabActive) {
        newInterval = 2000;
      }
      if (newInterval !== this.currentPollingInterval) {
        this.currentPollingInterval = newInterval;
        this.restartMessagePolling();
      }
    },

    formatMessage: function(text) {
      // YENİ: Mention formatlamayı entegre et
      if (window.ChatSpaceMentions && window.ChatSpaceMentions.formatMessageWithMentions) {
        return window.ChatSpaceMentions.formatMessageWithMentions(text);
      }
      return this.escapeHtml(text);
    },

    fetchMessages: function(reset) {
      const self = this;
      reset = reset || false;
      if (this.messageRefreshRunning && !reset) return;
      if (!this.currentRoomId) return;
      this.messageRefreshRunning = true;
      
      let url;
      if (reset || this.lastMessageId === 0) {
        url = '/chat-space/' + this.currentRoomId + '/messages?t=' + Date.now();
      } else {
        url = '/chat-space/' + this.currentRoomId + '/messages?since=' + this.lastMessageId + '&t=' + Date.now();
      }
      
      this.makeRequestWithToken(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      })
        .then(function(r) {
          if (!r.ok) {
            return r.text().then(function(text) {
              throw new Error('HTTP ' + r.status + ': ' + text);
            });
          }
          return r.json();
        })
        .then(function(data) {
          if (data.messages && data.messages.length > 0) {
            console.log('Yeni mesaj geldi:', data.messages.length, 'adet');
            if (reset || self.lastMessageId === 0) {
              self.renderMessages(data.messages, true);
            } else {
              self.renderMessages(data.messages, false);
            }
          } else {
            self.adaptPollingSpeed(false);
          }
        })
        .catch(function(error) {
          console.error('Message fetch failed:', error);
          self.adaptPollingSpeed(false);
        })
        .finally(function() {
          self.messageRefreshRunning = false;
        });
    },

    sendMessage: function(e) {
      const self = this;
      e.preventDefault();
      if (this.sendingMessage) return;
      const input = document.getElementById('chat-message-input');
      if (!input) return;
      let msg = input.value.trim();
      if (!msg) return;
      this.sendingMessage = true;
      
      const button = document.getElementById('chat-message-send');
      const originalButtonText = button ? button.innerHTML : '';
      if (button) {
        button.disabled = true;
        button.innerHTML = '⏳';
        button.style.opacity = '0.6';
      }
      input.disabled = true;
      input.style.opacity = '0.6';
      this.stopTyping();
      
      this.makeRequestWithToken('/chat-space/' + this.currentRoomId + '/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({message: msg})
      })
      .then(function(r) {
        if (!r.ok) {
          return r.text().then(function(text) {
            throw new Error('HTTP ' + r.status + ': ' + text);
          });
        }
        return r.json();
      })
      .then(function(data) {
        if (data.success && data.message) {
          self.renderMessages([data.message]);
          input.value = '';
          self.updateUserActivity();
          
          setTimeout(function() {
            if (window.ChatSpaceUsers && window.ChatSpaceUsers.fetchUsers) {
              window.ChatSpaceUsers.fetchUsers();
            }
          }, 500);
          
          if (button) {
            button.innerHTML = '✓';
            button.style.background = '#4CAF50';
            setTimeout(function() {
              button.innerHTML = originalButtonText;
              button.style.background = '';
            }, 1000);
          }
        } else if (data.error) {
          self.showNotification('Mesaj gönderilemedi: ' + data.error, 'error');
          input.value = msg;
        } else {
          self.showNotification('Beklenmeyen yanıt formatı', 'error');
          input.value = msg;
        }
      })
      .catch(function(error) {
        console.error('Send message error:', error);
        self.showNotification('Mesaj gönderilirken bir hata oluştu: ' + error.message, 'error');
        input.value = msg;
      })
      .finally(function() {
        self.sendingMessage = false;
        if (button) {
          button.disabled = false;
          if (button.innerHTML === '⏳') button.innerHTML = originalButtonText;
          button.style.opacity = '';
        }
        input.disabled = false;
        input.style.opacity = '';
        input.focus();
      });
    },

    startTyping: function() {
      if (this.isTyping) return;
      this.isTyping = true;
      this.makeRequestWithToken('/chat-space/' + this.currentRoomId + '/typing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({typing: true})
      }).catch(function(error) {
        // Typing hatalarını loglama
      });
    },

    stopTyping: function() {
      if (!this.isTyping) return;
      this.isTyping = false;
      this.makeRequestWithToken('/chat-space/' + this.currentRoomId + '/typing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({typing: false})
      }).catch(function(error) {
        // Typing hatalarını loglama
      });
    },

    escapeHtml: function(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    updateUserActivity: function() {
      this.lastUserActivity = Date.now();
    },

    restartMessagePolling: function() {
      const self = this;
      if (this.messagePollingInterval) {
        clearInterval(this.messagePollingInterval);
        this.messagePollingInterval = null;
      }
      this.messagePollingInterval = setInterval(function() {
        const containerCheck = document.getElementById('chat-space-container');
        if (!containerCheck || containerCheck.dataset.roomId !== self.currentRoomId) {
          clearInterval(self.messagePollingInterval);
          self.messagePollingInterval = null;
          return;
        }
        if (self.sendingMessage) return;
        self.fetchMessages(false);
      }, this.currentPollingInterval);
      window['chatSpace_msg_' + this.currentRoomId] = this.messagePollingInterval;
    },

    playNotificationSound: function() {
      if (this.lastMessageId > 0) {
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          oscillator.frequency.value = 800;
          oscillator.type = 'sine';
          gainNode.gain.setValueAtTime(0, audioContext.currentTime);
          gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) { }
      }
    },

    showNotification: function(message, type) {
      type = type || 'info';
      const toast = document.createElement('div');
      toast.className = 'chat-notification ' + type;
      toast.textContent = message;
      toast.style.cssText = 'position: fixed; top: 20px; right: 20px; background: ' + 
        (type === 'error' ? '#ff4444' : type === 'success' ? '#4CAF50' : '#4444ff') + 
        '; color: white; padding: 10px 20px; border-radius: 5px; z-index: 10000; opacity: 0; transition: opacity 0.3s;';
      document.body.appendChild(toast);
      setTimeout(function() { toast.style.opacity = '1'; }, 10);
      setTimeout(function() {
        toast.style.opacity = '0';
        setTimeout(function() {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
        }, 300);
      }, 3000);
    },

    setupInputEvents: function() {
      const self = this;
      const input = document.getElementById('chat-message-input');
      if (input) {
        input.addEventListener('keydown', function(e) {
          if (self.sendingMessage) {
            e.preventDefault();
            return;
          }
          self.updateUserActivity();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            self.sendMessage(e);
            return;
          }
          self.startTyping();
          if (self.userTypingTimeout) clearTimeout(self.userTypingTimeout);
          self.userTypingTimeout = setTimeout(function() {
            self.stopTyping();
          }, 3000);
        });
        
        input.addEventListener('blur', function() { 
          self.stopTyping(); 
        });
        
        input.addEventListener('focus', function() {
          self.scrollToBottom(true);
          self.updateUserActivity();
        });

        // YENİ: Mention sistemini başlat
        if (window.ChatSpaceMentions && self.currentRoomId && self.makeRequestWithToken) {
          window.ChatSpaceMentions.init(self.currentRoomId, self.makeRequestWithToken);
        }
      }
      
      const form = document.getElementById('chat-message-form');
      if (form) {
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        newForm.addEventListener('submit', function(e) {
          self.sendMessage(e);
        });
      }
    },

    setupTabVisibility: function() {
      const self = this;
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          self.isTabActive = false;
        } else {
          self.isTabActive = true;
          document.title = self.originalTitle;
          self.adaptPollingSpeed(false);
        }
      });
    }
  };

  // YENİ: Global fonksiyonlar (mesaj düzenleme/silme için)
  window.editMessage = function(messageId) {
    const editForm = document.getElementById('edit-form-' + messageId);
    const messageContent = document.querySelector('[data-message-id="' + messageId + '"] .chat-message-content');
    const actions = document.querySelector('[data-message-id="' + messageId + '"] .message-actions');
    
    if (editForm && messageContent) {
      editForm.classList.add('active');
      messageContent.style.display = 'none';
      if (actions) actions.style.display = 'none';
      
      const input = document.getElementById('edit-input-' + messageId);
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  };

  window.saveEdit = function(messageId) {
    const input = document.getElementById('edit-input-' + messageId);
    const newMessage = input.value.trim();
    
    if (!newMessage) {
      window.ChatSpaceMessages.showNotification('Boş mesaj gönderilemez.', 'error');
      return;
    }
    
    const saveBtn = document.querySelector('#edit-form-' + messageId + ' .message-edit-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Kaydediliyor...';
    
    window.ChatSpaceMessages.makeRequestWithToken('/chat-space/' + window.ChatSpaceMessages.currentRoomId + '/message/' + messageId + '/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({message: newMessage})
    })
    .then(function(r) {
      if (!r.ok) {
        return r.text().then(function(text) {
          throw new Error('HTTP ' + r.status + ': ' + text);
        });
      }
      return r.json();
    })
    .then(function(data) {
      if (data.success) {
        // Mesajı güncelle
        const messageContent = document.querySelector('[data-message-id="' + messageId + '"] .chat-message-content');
        const meta = document.querySelector('[data-message-id="' + messageId + '"] .chat-message-meta');
        
        if (messageContent) {
          messageContent.setAttribute('data-original-text', newMessage);
          // YENİ: Formatted message kullan
          const content = data.message.formatted_message || window.ChatSpaceMessages.formatMessage(newMessage);
          messageContent.innerHTML = content;
          messageContent.style.display = 'block';
        }
        
        // Düzenleme göstergesini ekle
        if (meta && !meta.querySelector('.chat-message-edited')) {
          meta.innerHTML += '<span class="chat-message-edited">(düzenlendi)</span>';
        }
        
        window.cancelEdit(messageId);
        window.ChatSpaceMessages.showNotification('Mesaj güncellendi.', 'success');
      } else {
        throw new Error(data.error || 'Bilinmeyen hata');
      }
    })
    .catch(function(error) {
      console.error('Edit failed:', error);
      window.ChatSpaceMessages.showNotification('Mesaj düzenlenemedi: ' + error.message, 'error');
    })
    .finally(function() {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Kaydet';
    });
  };

  window.cancelEdit = function(messageId) {
    const editForm = document.getElementById('edit-form-' + messageId);
    const messageContent = document.querySelector('[data-message-id="' + messageId + '"] .chat-message-content');
    const actions = document.querySelector('[data-message-id="' + messageId + '"] .message-actions');
    const input = document.getElementById('edit-input-' + messageId);
    
    if (editForm && messageContent) {
      editForm.classList.remove('active');
      messageContent.style.display = 'block';
      if (actions) actions.style.display = 'flex';
      
      // Orijinal metni geri yükle
      if (input && messageContent.dataset.originalText) {
        input.value = messageContent.dataset.originalText;
      }
    }
  };

  window.deleteMessage = function(messageId) {
    if (!confirm('Bu mesajı silmek istediğinizden emin misiniz?')) {
      return;
    }
    
    const deleteBtn = document.querySelector('[data-message-id="' + messageId + '"] .delete-btn');
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = '⏳';
    }
    
    window.ChatSpaceMessages.makeRequestWithToken('/chat-space/' + window.ChatSpaceMessages.currentRoomId + '/message/' + messageId + '/delete', {
      method: 'POST'
    })
    .then(function(r) {
      if (!r.ok) {
        return r.text().then(function(text) {
          throw new Error('HTTP ' + r.status + ': ' + text);
        });
      }
      return r.json();
    })
    .then(function(data) {
      if (data.success) {
        // Mesajı kaldır veya "silindi" olarak işaretle
        const messageBubble = document.querySelector('[data-message-id="' + messageId + '"]');
        if (messageBubble) {
          messageBubble.style.opacity = '0.5';
          messageBubble.classList.add('deleted');
          
          const messageContent = messageBubble.querySelector('.chat-message-content');
          if (messageContent) {
            messageContent.innerHTML = '<em>Bu mesaj silindi.</em>';
          }
          
          const actions = messageBubble.querySelector('.message-actions');
          if (actions) {
            actions.remove();
          }
        }
        window.ChatSpaceMessages.showNotification('Mesaj silindi.', 'success');
      } else {
        throw new Error(data.error || 'Bilinmeyen hata');
      }
    })
    .catch(function(error) {
      console.error('Delete failed:', error);
      window.ChatSpaceMessages.showNotification('Mesaj silinemedi: ' + error.message, 'error');
      if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '🗑️';
      }
    });
  };

})(Drupal, drupalSettings);