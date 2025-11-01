(function (Drupal, drupalSettings) {
  'use strict';

  Drupal.behaviors.chatSpace = {
    attach: function(context, settings) {
      const container = document.getElementById('chat-space-container');
      if (!container || container.hasAttribute('data-chat-processed')) {
        return;
      }

      // YENİ: Clear history sayfası için özel işlem
      if (drupalSettings.chatSpace && drupalSettings.chatSpace.clearHistory) {
        const confirmCheckbox = document.getElementById('confirm-delete');
        const deleteButton = document.getElementById('delete-btn');
        
        if (confirmCheckbox && deleteButton) {
          confirmCheckbox.addEventListener('change', function() {
            deleteButton.disabled = !this.checked;
            if (this.checked) {
              deleteButton.style.opacity = '1';
              deleteButton.style.cursor = 'pointer';
            } else {
              deleteButton.style.opacity = '0.5';
              deleteButton.style.cursor = 'not-allowed';
            }
          });
        }
        return; // Clear history sayfasında chat işlevlerini başlatma
      }

      initializeChat(container);

      function initializeChat(container) {
        container.setAttribute('data-chat-processed', 'true');

        let currentRoomId = container.dataset.roomId;
        // EMOJI: emojiPanelVisible ve emojiList buradan çıkarıldı
        let userTypingTimeout = null;
        let isTyping = false;
        let typingUsers = new Set();
        let heartbeatInterval = null;
        let lastUserActivity = Date.now();
        let settingsDropdownOpen = false;
        let csrfToken = '';
        let mobileUserListOpen = false;

        let userRefreshRunning = false;

        // EMOJI: emojiList çıkarıldı

        function refreshToken() {
          return fetch('/chat-space/get-token', {
            method: 'GET',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
            },
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.token) {
              csrfToken = data.token;
              return csrfToken;
            }
            throw new Error('No token in response');
          })
          .catch(function(error) {
            console.error('Token refresh failed:', error);
            csrfToken = drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '';
            return csrfToken;
          });
        }

        function makeRequestWithToken(url, options) {
          options = options || {};
          const token = csrfToken || (drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '');
          
          const defaultHeaders = {
            'X-Requested-With': 'XMLHttpRequest',
            'Cache-Control': 'no-cache',
          };
          
          if (token) {
            defaultHeaders['X-CSRF-Token'] = token;
          }
          
          const finalOptions = {
            method: options.method || 'GET',
            headers: Object.assign(defaultHeaders, options.headers || {}),
            body: options.body || null
          };
          
          return fetch(url, finalOptions);
        }

        function renderUserList(users) {
          const userlist = document.querySelector('.userlist-list');
          if (!userlist) {
            return;
          }
          
          userlist.innerHTML = '';
          
          if (!users || users.length === 0) {
            userlist.innerHTML = '<li><span>Kimse yok</span></li>';
            return;
          }
          
          users.forEach(function(user) {
            const li = document.createElement('li');
            const isCurrentUser = user.uid == drupalSettings.user?.uid;
            
            const statusClass = user.status || 'offline';
            const currentUserClass = isCurrentUser ? 'current-user' : '';
            
            li.className = 'userlist-item user-' + statusClass + ' ' + currentUserClass;
            
            let avatarUrl = user.avatar || '/modules/custom/chatspace/images/default-avatar.png';
            
            if (avatarUrl.startsWith('/') && !avatarUrl.startsWith('//')) {
              const baseUrl = window.location.origin;
              avatarUrl = baseUrl + avatarUrl;
            }
            
            li.innerHTML = '<div class="user-avatar-container">' +
              '<img src="' + escapeHtml(avatarUrl) + '" loading="lazy" alt="Avatar" onerror="this.src=\'/modules/custom/chatspace/images/default-avatar.png\';" />' +
              '<span class="user-status-dot ' + statusClass + '" title="' + statusClass + '"></span>' +
              '</div>' +
              '<div class="user-info">' +
              '<span class="userlist-name">' + escapeHtml(user.name) + '</span>' +
              '</div>';
            
            userlist.appendChild(li);
          });
          
          const allDots = userlist.querySelectorAll('.user-status-dot');
          allDots.forEach(function(dot) {
            dot.textContent = '';
            dot.innerHTML = '';
          });
        }

        function fetchUsers() {
          if (userRefreshRunning) return;
          userRefreshRunning = true;
          
          makeRequestWithToken('/chat-space/' + currentRoomId + '/users?t=' + Date.now())
            .then(function(r) {
              if (!r.ok) {
                if (r.status === 403) {
                  return refreshToken().then(function() {
                    return makeRequestWithToken('/chat-space/' + currentRoomId + '/users?t=' + Date.now());
                  });
                }
                return r.text().then(function(text) {
                  throw new Error('HTTP ' + r.status + ': ' + text);
                });
              }
              return r.json();
            })
            .then(function(data) {
              if (data && data.users && Array.isArray(data.users) && data.users.length > 0) {
                renderUserList(data.users);
                updateUserCount(data.users.length, data.stats);
              } else {
                createFallbackUserList();
              }
            })
            .catch(function(error) {
              console.error('User fetch failed:', error);
              createFallbackUserList();
            })
            .finally(function() {
              userRefreshRunning = false;
            });
        }

        function createFallbackUserList() {
          const fallbackUsers = [
            {
              uid: drupalSettings.user?.uid || 1,
              name: drupalSettings.user?.name || 'You',
              avatar: '/modules/custom/chatspace/images/default-avatar.png',
              status: 'active',
              is_online: true,
              in_room: true,
            }
          ];
          
          renderUserList(fallbackUsers);
          updateUserCount(fallbackUsers.length);
        }

        function updateUserCount(count, stats) {
          const header = document.querySelector('.userlist-header .user-count');
          if (header) {
            if (stats) {
              const activeCount = stats.active_in_room + stats.online_elsewhere;
              const tooltip = 'Toplam: ' + stats.total + '\n🟢 Odada: ' + stats.active_in_room + '\n🟡 Online: ' + stats.online_elsewhere + '\n⚪ Son 24h: ' + stats.recently_active;
              header.textContent = '(' + activeCount + ')';
              header.title = tooltip;
            } else {
              header.textContent = '(' + count + ')';
            }
          }
          
          const toggleButton = document.getElementById('mobile-user-toggle');
          if (toggleButton) {
            const toggleText = toggleButton.querySelector('.toggle-text');
            if (toggleText) {
              const baseText = mobileUserListOpen ? 'Gizle' : 'Kullanıcılar';
              if (stats) {
                const activeCount = stats.active_in_room + stats.online_elsewhere;
                toggleText.textContent = baseText + ' (' + activeCount + ')';
              } else {
                toggleText.textContent = baseText + ' (' + count + ')';
              }
            }
          }
        }

        function escapeHtml(text) {
          if (!text) return '';
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        function updateUserActivity() {
          lastUserActivity = Date.now();
        }

        function sendHeartbeat() {
          makeRequestWithToken('/chat-space/' + currentRoomId + '/heartbeat', {
            method: 'POST'
          }).catch(function(error) {
            // Heartbeat hatalarını loglama
          });
        }

        function setupAutorefresh() {
          // User refresh intervali - instant feeling için
          const userInterval = setInterval(function() {
            const containerCheck = document.getElementById('chat-space-container');
            if (!containerCheck || containerCheck.dataset.roomId !== currentRoomId) {
              clearInterval(userInterval);
              return;
            }
            fetchUsers();
          }, 2000);
          
          heartbeatInterval = setInterval(function() {
            const containerCheck = document.getElementById('chat-space-container');
            if (!containerCheck || containerCheck.dataset.roomId !== currentRoomId) {
              clearInterval(heartbeatInterval);
              return;
            }
            sendHeartbeat();
          }, 5000);
          
          const typingInterval = setInterval(function() {
            const containerCheck = document.getElementById('chat-space-container');
            if (!containerCheck || containerCheck.dataset.roomId !== currentRoomId) {
              clearInterval(typingInterval);
              return;
            }
            cleanupTypingIndicators();
          }, 3000);
          
          window['chatSpace_usr_' + currentRoomId] = userInterval;
          window['chatSpace_hbt_' + currentRoomId] = heartbeatInterval;
          window['chatSpace_typ_' + currentRoomId] = typingInterval;
        }

        function cleanupTypingIndicators() {
          const typingElements = document.querySelectorAll('.user-typing');
          typingElements.forEach(function(el) {
            const parent = el.closest('.userlist-item');
            if (parent) el.remove();
          });
        }

        // EMOJI: setupEmojiPicker() çağrısı aynı kaldı, fonksiyon artık ayrı dosyada global
        // USER TOGGLE
        function setupUserToggle() {
          const toggleButton = document.getElementById('mobile-user-toggle');
          const userList = document.getElementById('chat-userlist');
          const overlay = document.getElementById('mobile-sidebar-overlay');
          const closeButton = document.getElementById('close-sidebar');
          const mainContainer = document.querySelector('.chat-space-main');

          if (!toggleButton || !userList) return;

          toggleButton.addEventListener('click', function(e) {
            e.preventDefault();
            
            mobileUserListOpen = !mobileUserListOpen;
            
            if (window.innerWidth <= 768) {
              // Mobile
              if (mobileUserListOpen) {
                userList.classList.add('mobile-open');
                if (overlay) overlay.classList.add('active');
                toggleButton.classList.add('active');
              } else {
                userList.classList.remove('mobile-open');
                if (overlay) overlay.classList.remove('active');
                toggleButton.classList.remove('active');
              }
            } else {
              // Desktop
              if (mobileUserListOpen) {
                userList.classList.add('desktop-hidden');
                if (mainContainer) mainContainer.classList.add('userlist-hidden');
                toggleButton.classList.add('active');
              } else {
                userList.classList.remove('desktop-hidden');
                if (mainContainer) mainContainer.classList.remove('userlist-hidden');
                toggleButton.classList.remove('active');
              }
            }
            
            const toggleText = toggleButton.querySelector('.toggle-text');
            if (toggleText) {
              toggleText.textContent = mobileUserListOpen ? 'Gizle' : 'Kullanıcılar';
            }
          });

          if (closeButton) {
            closeButton.addEventListener('click', function(e) {
              e.preventDefault();
              mobileUserListOpen = false;
              userList.classList.remove('mobile-open');
              if (overlay) overlay.classList.remove('active');
              toggleButton.classList.remove('active');
              
              const toggleText = toggleButton.querySelector('.toggle-text');
              if (toggleText) {
                toggleText.textContent = 'Kullanıcılar';
              }
            });
          }

          if (overlay) {
            overlay.addEventListener('click', function(e) {
              if (mobileUserListOpen) {
                mobileUserListOpen = false;
                userList.classList.remove('mobile-open');
                overlay.classList.remove('active');
                toggleButton.classList.remove('active');
                
                const toggleText = toggleButton.querySelector('.toggle-text');
                if (toggleText) {
                  toggleText.textContent = 'Kullanıcılar';
                }
              }
            });
          }
        }

        // ROOM SETTINGS
        function setupRoomSettings() {
          const settingsButton = document.getElementById('room-settings-btn');
          if (!settingsButton) return;

          const dropdown = document.createElement('div');
          dropdown.className = 'room-settings-dropdown';
          dropdown.innerHTML = 
            '<a href="/chat-space/' + currentRoomId + '/clear-history" class="danger">🗑️ Sohbet Geçmişini Temizle</a>' +
            '<a href="/chat-space/' + currentRoomId + '/edit">✏️ Odayı Düzenle</a>';
          
          settingsButton.appendChild(dropdown);

          settingsButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            if (e.target.tagName === 'A') {
              return;
            }
            
            settingsDropdownOpen = !settingsDropdownOpen;
            
            if (settingsDropdownOpen) {
              dropdown.classList.add('active');
            } else {
              dropdown.classList.remove('active');
            }
          });

          dropdown.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
              e.stopPropagation();
              dropdown.classList.remove('active');
              settingsDropdownOpen = false;
              return true;
            }
          });

          document.addEventListener('click', function(e) {
            if (settingsDropdownOpen && !settingsButton.contains(e.target)) {
              dropdown.classList.remove('active');
              settingsDropdownOpen = false;
            }
          });
        }

        // Kullanıcı objesini global erişim için ayarla
        window.ChatSpaceUsers = {
          fetchUsers: fetchUsers,
          renderUserList: renderUserList,
          updateUserCount: updateUserCount,
          createFallbackUserList: createFallbackUserList
        };

        // SETUP EVENT HANDLERS
        if (typeof window.setupEmojiPicker === 'function') {
          window.setupEmojiPicker();
        }
        setupUserToggle();
        setupRoomSettings();

        // Messages modülünü başlat
        if (window.ChatSpaceMessages) {
          window.ChatSpaceMessages.init(currentRoomId, makeRequestWithToken, csrfToken);
          window.ChatSpaceMessages.setupInputEvents();
          window.ChatSpaceMessages.setupTabVisibility();
        }

        // INITIALIZE - İLK SCROLL DA EKLENDI
        setTimeout(function() {
          refreshToken()
            .then(function(token) {
              fetchUsers();
              if (window.ChatSpaceMessages) {
                window.ChatSpaceMessages.fetchMessages(true);
                window.ChatSpaceMessages.restartMessagePolling();
              }
              setupAutorefresh();
              // İlk yükleme sonrası scroll
              setTimeout(function() {
                if (window.ChatSpaceMessages) {
                  window.ChatSpaceMessages.scrollToBottom(false);
                }
              }, 500);
            })
            .catch(function(error) {
              console.warn('Token refresh failed, using fallback:', error);
              csrfToken = drupalSettings.chatSpace?.token || '';
              fetchUsers();
              if (window.ChatSpaceMessages) {
                window.ChatSpaceMessages.fetchMessages(true);
                window.ChatSpaceMessages.restartMessagePolling();
              }
              setupAutorefresh();
              // Fallback durumunda da scroll
              setTimeout(function() {
                if (window.ChatSpaceMessages) {
                  window.ChatSpaceMessages.scrollToBottom(false);
                }
              }, 500);
            });
        }, 100);
      }
    },

    detach: function(context, settings, trigger) {
      if (trigger === 'unload') {
        Object.keys(window).forEach(function(key) {
          if (key.startsWith('chatSpace_')) {
            clearInterval(window[key]);
            delete window[key];
          }
        });
      }
    }
  };

})(Drupal, drupalSettings);