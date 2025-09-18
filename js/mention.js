(function (Drupal, drupalSettings) {
  'use strict';

  // Mention sistemi
  window.ChatSpaceMentions = {
    autocompleteVisible: false,
    selectedIndex: -1,
    currentUsers: [],
    lastQuery: '',
    mentionStartPos: -1,

    init: function(currentRoomId, makeRequestWithToken) {
      this.currentRoomId = currentRoomId;
      this.makeRequestWithToken = makeRequestWithToken;
      this.setupMentionInput();
    },

    setupMentionInput: function() {
      const self = this;
      const input = document.getElementById('chat-message-input');
      
      if (!input || input.hasAttribute('data-mention-processed')) {
        return;
      }
      
      input.setAttribute('data-mention-processed', 'true');

      // Autocomplete container oluştur
      this.createAutocompleteContainer(input);

      // Input event'leri
      input.addEventListener('input', function(e) {
        self.handleInput(e);
      });

      input.addEventListener('keydown', function(e) {
        self.handleKeydown(e);
      });

      // Input blur - autocomplete'i gizle
      input.addEventListener('blur', function(e) {
        // Küçük delay ile - kullanıcı autocomplete'den seçim yapabilsin
        setTimeout(function() {
          self.hideAutocomplete();
        }, 200);
      });

      // Click outside - autocomplete'i gizle
      document.addEventListener('click', function(e) {
        if (!e.target.closest('.mention-autocomplete-container')) {
          self.hideAutocomplete();
        }
      });
    },

    createAutocompleteContainer: function(input) {
      const container = document.createElement('div');
      container.className = 'mention-autocomplete-container';
      container.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        background: #2c2f36;
        border: 1px solid #404651;
        border-radius: 8px;
        max-height: 200px;
        overflow-y: auto;
        z-index: 1000;
        display: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        margin-bottom: 5px;
      `;

      // Input'un parent'ına ekle
      const parent = input.parentElement;
      parent.style.position = 'relative';
      parent.appendChild(container);

      this.autocompleteContainer = container;
    },

    handleInput: function(e) {
      const input = e.target;
      const text = input.value;
      const cursorPos = input.selectionStart;

      // @ karakterini ara
      const mentionMatch = this.findMentionAtCursor(text, cursorPos);
      
      if (mentionMatch) {
        this.mentionStartPos = mentionMatch.start;
        const query = mentionMatch.query;
        
        if (query !== this.lastQuery) {
          this.lastQuery = query;
          this.searchUsers(query);
        }
      } else {
        this.hideAutocomplete();
      }
    },

    handleKeydown: function(e) {
      if (!this.autocompleteVisible) {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.moveSelection(-1);
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          this.selectUser();
          break;
        case 'Escape':
          e.preventDefault();
          this.hideAutocomplete();
          break;
      }
    },

    findMentionAtCursor: function(text, cursorPos) {
      // Cursor pozisyonundan geriye doğru @ karakterini ara
      let start = -1;
      
      for (let i = cursorPos - 1; i >= 0; i--) {
        const char = text[i];
        
        if (char === '@') {
          start = i;
          break;
        }
        
        // Boşluk ya da satır sonu bulursa @ aramayı durdur
        if (char === ' ' || char === '\n' || char === '\t') {
          break;
        }
      }

      if (start === -1) {
        return null;
      }

      // @ den sonraki metni al
      const afterAt = text.substring(start + 1, cursorPos);
      
      // Sadece geçerli karakterler (alfanumerik, tire, alt çizgi)
      if (!/^[a-zA-Z0-9\-_]*$/.test(afterAt)) {
        return null;
      }

      return {
        start: start,
        query: afterAt
      };
    },

    searchUsers: function(query) {
      const self = this;
      
      // Minimum 0 karakter ile arama (tüm kullanıcıları göster)
      this.makeRequestWithToken('/chat-space/' + this.currentRoomId + '/mention/users?q=' + encodeURIComponent(query))
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Search failed');
          }
          return response.json();
        })
        .then(function(data) {
          if (data.success && data.users) {
            self.currentUsers = data.users;
            self.showAutocomplete();
          } else {
            self.hideAutocomplete();
          }
        })
        .catch(function(error) {
          console.error('User search error:', error);
          self.hideAutocomplete();
        });
    },

    showAutocomplete: function() {
      const container = this.autocompleteContainer;
      
      if (!container || this.currentUsers.length === 0) {
        this.hideAutocomplete();
        return;
      }

      container.innerHTML = '';
      this.selectedIndex = -1;

      this.currentUsers.forEach((user, index) => {
        const item = document.createElement('div');
        item.className = 'mention-autocomplete-item';
        item.dataset.index = index;
        item.style.cssText = `
          padding: 8px 12px;
          cursor: pointer;
          color: #f5f6fa;
          font-size: 14px;
          transition: background 0.2s ease;
          display: flex;
          align-items: center;
          gap: 8px;
        `;

        item.innerHTML = `
          <span class="mention-user-avatar" style="
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #404651;
            display: inline-block;
            font-size: 12px;
            text-align: center;
            line-height: 20px;
          ">${user.name.charAt(0).toUpperCase()}</span>
          <span class="mention-user-name">${this.escapeHtml(user.name)}</span>
        `;

        // Click handler
        item.addEventListener('click', () => {
          this.selectedIndex = index;
          this.selectUser();
        });

        // Hover handler
        item.addEventListener('mouseenter', () => {
          this.setSelection(index);
        });

        container.appendChild(item);
      });

      container.style.display = 'block';
      this.autocompleteVisible = true;
    },

    hideAutocomplete: function() {
      if (this.autocompleteContainer) {
        this.autocompleteContainer.style.display = 'none';
      }
      this.autocompleteVisible = false;
      this.selectedIndex = -1;
      this.currentUsers = [];
      this.lastQuery = '';
      this.mentionStartPos = -1;
    },

    moveSelection: function(direction) {
      if (this.currentUsers.length === 0) return;

      this.selectedIndex += direction;
      
      if (this.selectedIndex < 0) {
        this.selectedIndex = this.currentUsers.length - 1;
      } else if (this.selectedIndex >= this.currentUsers.length) {
        this.selectedIndex = 0;
      }

      this.setSelection(this.selectedIndex);
    },

    setSelection: function(index) {
      // Önceki seçimi temizle
      const items = this.autocompleteContainer.querySelectorAll('.mention-autocomplete-item');
      items.forEach(item => {
        item.style.background = 'transparent';
      });

      // Yeni seçimi vurgula
      if (items[index]) {
        items[index].style.background = '#404651';
        this.selectedIndex = index;
      }
    },

    selectUser: function() {
      if (this.selectedIndex === -1 || !this.currentUsers[this.selectedIndex]) {
        return;
      }

      const user = this.currentUsers[this.selectedIndex];
      const input = document.getElementById('chat-message-input');
      
      if (!input || this.mentionStartPos === -1) {
        return;
      }

      const text = input.value;
      const cursorPos = input.selectionStart;
      
      // @ den önceki metin + @kullanıcıadı + @ den sonraki metin
      const beforeMention = text.substring(0, this.mentionStartPos);
      const afterCursor = text.substring(cursorPos);
      const newText = beforeMention + '@' + user.name + ' ' + afterCursor;
      
      input.value = newText;
      
      // Cursor'u doğru pozisyona koy
      const newCursorPos = this.mentionStartPos + user.name.length + 2; // @ + kullanıcıadı + boşluk
      input.setSelectionRange(newCursorPos, newCursorPos);
      
      this.hideAutocomplete();
      input.focus();
    },

    escapeHtml: function(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    // Mesaj formatlamada mention'ları vurgula
    formatMessageWithMentions: function(text) {
      return text.replace(/@([a-zA-Z0-9\-_]+)/g, function(match, username) {
        return '<span class="user-mention" title="@' + username + '">' + match + '</span>';
      });
    }
  };

  // CSS stilleri ekle
  const mentionStyles = `
    .user-mention {
      background: rgba(49, 120, 255, 0.2) !important;
      color: #3178ff !important;
      padding: 1px 4px !important;
      border-radius: 3px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
    }
    
    .user-mention:hover {
      background: rgba(49, 120, 255, 0.3) !important;
      color: #ffffff !important;
    }
    
    .mention-autocomplete-container::-webkit-scrollbar {
      width: 6px;
    }
    
    .mention-autocomplete-container::-webkit-scrollbar-track {
      background: #2e313a;
    }
    
    .mention-autocomplete-container::-webkit-scrollbar-thumb {
      background: #444;
      border-radius: 3px;
    }
    
    .mention-autocomplete-container::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
  `;

  // Style'ı head'e ekle
  if (!document.getElementById('mention-styles')) {
    const style = document.createElement('style');
    style.id = 'mention-styles';
    style.textContent = mentionStyles;
    document.head.appendChild(style);
  }

})(Drupal, drupalSettings);