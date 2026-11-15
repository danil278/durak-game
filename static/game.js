// === 1. ИНИЦИАЛИЗАЦИЯ СОКЕТА И ПРОФИЛЯ В САМОМ ВЕРХУ ===
const socket = typeof io !== 'undefined' ? io({ transports: ['polling'] }) : null;
let userProfile = JSON.parse(localStorage.getItem('durak_user_profile'));

// Настройки игры изначально пустые — их выдаст сервер
let savedSettings = null; 
let tokenToSlotMap = {};

window.addEventListener('pageshow', (event) => {
  const navEntries = performance.getEntriesByType('navigation');
  const isBackForward = navEntries.length > 0 && navEntries[0].type === 'back_forward';
  if (event.persisted || isBackForward) {
    window.location.replace('/');
  }
});

console.log("Скрипт игры запущен. Ожидаем настройки от сервера...");

document.addEventListener('DOMContentLoaded', () => {

  // --- ПОИСК ЭЛЕМЕНТОВ ИНТЕРФЕЙСА ---
  const oppArea = document.getElementById('opponents-area');
  const deckArea = document.getElementById('deck-area');
  const battleArea = document.getElementById('battle-area');
  const handAnchor = document.getElementById('player-hand');
  const mainBtn = document.getElementById('main-btn');
  const cardsLeftEl = document.getElementById('cards-left');
  
  const topGameModes = document.getElementById('top-game-modes');
  const topGameBet = document.getElementById('top-game-bet');

  const btnInvite = document.getElementById('btn-invite');
  const invitePopup = document.getElementById('invite-popup');
  const inviteClose = document.getElementById('invite-close');

  // --- ИГРОВЫЕ ПЕРЕМЕННЫЕ ---
  let draggedCard = null;
  let startX = 0;
  let startY = 0;
  let playerHandCards = [];
  let tablePairs = [];
  let deckCount = 24; // Дефолтное значение, перезапишется сервером
  let currentTrumpSuit = '';

  const appSettings = JSON.parse(localStorage.getItem('durak_app_settings')) || {
    sortCards: true,
    emotes: true,
    lang: 'ru'
  };
  const isEn = appSettings.lang === 'en';
  
  if (isEn) {
    if (btnInvite) btnInvite.innerText = '➕ Invite Friends';
    const invHeader = document.querySelector('#invite-popup .invite-header span');
    if (invHeader) invHeader.innerText = 'Invite Friends';
    if (mainBtn) mainBtn.innerText = 'Ready';
  }

  const RANK_WEIGHTS = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  const SUIT_WEIGHTS = { '♠': 1, '♣': 2, '♦': 3, '♥': 4 };

  function sortPlayerHand(cards) {
    if (!appSettings.sortCards || !Array.isArray(cards)) return cards;
    return [...cards].sort((a, b) => {
      const aTrump = a[1] === currentTrumpSuit ? 1 : 0;
      const bTrump = b[1] === currentTrumpSuit ? 1 : 0;
      if (aTrump !== bTrump) return aTrump - bTrump;
      if (a[1] !== b[1]) return (SUIT_WEIGHTS[a[1]] || 0) - (SUIT_WEIGHTS[b[1]] || 0);
      return (RANK_WEIGHTS[a[0]] || 0) - (RANK_WEIGHTS[b[0]] || 0);
    });
  }

  // Если смайлики выключены в настройках — скрываем кнопку эмоций на аватарке
  if (!appSettings.emotes) {
    const emoteTriggers = document.querySelectorAll('.player-profile .chat-badge, .player-profile .chat-btn, .player-profile .emote-btn, .emote-trigger, #emote-btn, #emoji-popup');
    emoteTriggers.forEach(el => { el.style.setProperty('display', 'none', 'important'); });
  }

  let gameInProgress = false;

  function showBackToMenuButton() {
    if (document.getElementById('end-game-menu-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'end-game-menu-btn';
    btn.innerText = isEn ? '🏠 Main Menu' : '🏠 В главное меню';
    btn.style.cssText = `
      position: absolute;
      top: 52%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--amber);
      color: #111;
      border: none;
      padding: 12px 24px;
      border-radius: 999px;
      font-family: 'Sora', sans-serif;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      z-index: 1600;
      box-shadow: 0 8px 25px rgba(255, 193, 7, 0.45);
    `;
    btn.onclick = () => {
      matchEndedCleanly = true
      if (socket) socket.disconnect();
      window.location.replace('/');
    };
    const phone = document.querySelector('.phone');
    if (phone) phone.appendChild(btn);
  }

  function openSurrenderConfirm() {
    let modal = document.getElementById('surrender-confirm-modal');
    if (modal) {
      modal.style.display = 'flex';
      return;
    }
    modal = document.createElement('div');
    modal.id = 'surrender-confirm-modal';
    modal.style.cssText = `
      position: absolute; inset: 0; background: rgba(0, 0, 0, 0.75);
      display: flex; align-items: center; justify-content: center;
      z-index: 2000; padding: 20px;
    `;
    modal.innerHTML = `
      <div style="background: #1c1c1e; border: 1px solid var(--border); border-radius: 20px; padding: 20px; width: 100%; max-width: 300px; text-align: center; box-shadow: 0 12px 32px rgba(0,0,0,0.8);">
        <div style="font-size: 28px; margin-bottom: 8px;">🏳️</div>
        <div style="font-size: 16px; font-weight: 800; margin-bottom: 6px; color: var(--text);">
          ${isEn ? 'Surrender match?' : 'Точно сдаться?'}
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 18px; line-height: 1.4;">
          ${isEn ? 'You will lose this match and your opponent gets +1 🪙.' : 'Вам засчитается поражение, а соперник получит победу (+1 🪙).'}
        </div>
        <div style="display: flex; gap: 10px;">
          <button id="surrender-no-btn" style="flex: 1; padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-weight: 700; cursor: pointer;">
            ${isEn ? 'Cancel' : 'Отмена'}
          </button>
          <button id="surrender-yes-btn" style="flex: 1; padding: 10px; border-radius: 12px; border: none; background: #e74c3c; color: #fff; font-weight: 700; cursor: pointer;">
            ${isEn ? 'Surrender' : 'Сдаться'}
          </button>
        </div>
      </div>
    `;
    const phone = document.querySelector('.phone');
    if (phone) phone.appendChild(modal);

    document.getElementById('surrender-no-btn').onclick = () => {
      modal.style.display = 'none';
    };
    document.getElementById('surrender-yes-btn').onclick = () => {
      modal.style.display = 'none';
      socket.emit('surrender_game', { token: userProfile.token });
    };
  }

  // Привязываем верхнюю левую кнопку (сдаться / выйти из лобби)
  // Привязываем верхнюю левую кнопку <div class="btn-icon-top">🔄</div>
  const topLeftSurrenderBtn = document.querySelector('.top-bar .btn-icon-top');
  if (topLeftSurrenderBtn) {
    topLeftSurrenderBtn.style.cursor = 'pointer';
    topLeftSurrenderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (gameInProgress) {
        openSurrenderConfirm();
      } else {
        if (socket && userProfile) {
          socket.emit('leave_game', { token: userProfile.token });
          socket.disconnect();
        }
        window.location.replace('/');
      }
    });
  }

  let matchEndedCleanly = false;

  // Запираем страницу в истории браузера, чтобы кнопка "Назад" не выкидывала из партии
  history.pushState({ inGame: true }, '', window.location.href);
  window.addEventListener('popstate', () => {
    history.pushState({ inGame: true }, '', window.location.href);
    if (gameInProgress) {
      openSurrenderConfirm();
    } else {
      matchEndedCleanly = true;
      if (socket && userProfile) {
        socket.emit('leave_game', { token: userProfile.token });
      }
      window.location.replace('/');
    }
  });

  window.addEventListener('pagehide', () => {
    if (socket && userProfile && !matchEndedCleanly) {
      socket.emit('leave_game', { token: userProfile.token });
    }
  });

  let isCheaterMode = false;
  let myCoins = userProfile ? (userProfile.gold ?? 5) : 5;
  let highlightEnabled = false;
  let currentTurnToken = '';
  let currentDefenderToken = '';
  const rankOrder = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};

  const actionsContainer = document.querySelector('.bottom-actions-container');
  const actionItems = actionsContainer ? actionsContainer.querySelectorAll('.action-item') : [];
  const coinsDisplayEl = actionsContainer ? actionsContainer.querySelector('.action-bottom-vals span:first-child') : null;

  if (actionItems.length === 3) {
    // 1. ❌ (1 монета) — Вернуть случайно брошенную карту
    actionItems[0].addEventListener('click', () => {
      if (myCoins < 1) { showToast(isEn ? 'Need 1🪙' : 'Нужна 1🪙'); return; }
      socket.emit('undo_move', { token: userProfile.token });
    });

    // 2. 👁️ (3 монеты) — Напомнить карты в отбое
    actionItems[1].addEventListener('click', () => {
      if (myCoins < 3) { showToast(isEn ? 'Need 3🪙' : 'Нужно 3🪙'); return; }
      socket.emit('get_discard_pile', { token: userProfile.token });
    });

    // 3. 🔍 (2 монеты) — Подсветка подходящих карт до конца игры
    actionItems[2].addEventListener('click', () => {
      if (highlightEnabled) { showToast(isEn ? 'Highlight already active' : 'Подсветка уже активна'); return; }
      if (myCoins < 2) { showToast(isEn ? 'Need 2🪙' : 'Нужно 2🪙'); return; }
      socket.emit('buy_highlight', { token: userProfile.token });
    });
  }

  if (userProfile) {
    const pName = document.querySelector('.player-name');
    const pAvatar = document.querySelector('.player-avatar');
    if (pName) pName.innerText = userProfile.name;
    if (pAvatar) {
        pAvatar.style.overflow = 'hidden';
        pAvatar.innerHTML = renderAvatarHtml(userProfile.avatar, userProfile.name, '18px');
    }
  }

  // Словарь для перевода названия режима в эмодзи
  const modeEmojis = {
      "подкидной": "↗️", "соседи": "↔️", "с шулерами": "🕵️",
      "классика": "🃏", "переводной": "🔄", "все": "🔀",
      "честная": "🤝", "ничья": "🟰"
  };

  const modeDescriptions = isEn ? {
      "подкидной": "↗️ Throw-in: you can throw in cards matching any rank on the table",
      "переводной": "🔄 Transfer: you can pass the attack to the next player with the same rank",
      "соседи": "↔️ Neighbors: only the two neighbors of the defender can throw in",
      "все": "🔀 All: any player at the table can throw in cards",
      "с шулерами": "🕵️ Cheaters: illegal moves are allowed, but opponents can catch you by tapping the card",
      "честная": "🤝 Fair play: all attacks and defenses must follow standard rules",
      "классика": "🃏 Classic: no draws — the first player to empty their hand wins",
      "ничья": "🟰 Draw: if the last players run out of cards in the same round, it's a draw"
  } : {
      "подкидной": "↗️ Подкидной: можно подкидывать карты того же номинала, что уже лежат на столе",
      "переводной": "🔄 Переводной: можно перевести атаку на следующего игрока картой того же достоинства",
      "соседи": "↔️ Соседи: подкидывать могут только двое соседей отбивающегося",
      "все": "🔀 Все: подкидывать могут все игроки за столом, кроме отбивающегося",
      "с шулерами": "🕵️ С шулерами: можно ходить не по правилам, но соперник поймает кликом по карте",
      "честная": "🤝 Честная игра: ходить и биться можно строго по правилам",
      "классика": "🃏 Классика: ничьей быть не может — вышедший первым побеждает",
      "ничья": "🟰 Ничья: если карты закончились одновременно в одном кону — объявляется ничья"
  };

  function showModeHint(text) {
    let hint = document.getElementById('mode-hint-tooltip');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'mode-hint-tooltip';
      hint.style.cssText = `
        position: absolute;
        top: 52px;
        left: 50%;
        transform: translateX(-50%);
        max-width: 310px;
        background: rgba(20, 20, 22, 0.96);
        border: 1px solid var(--amber);
        color: var(--text);
        padding: 8px 14px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.35;
        text-align: center;
        z-index: 1500;
        box-shadow: 0 8px 24px rgba(0,0,0,0.75);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
      `;
      const phone = document.querySelector('.phone');
      if (phone) phone.appendChild(hint);
    }
    hint.innerText = text;
    hint.style.opacity = '1';
    clearTimeout(window.modeHintTimer);
    window.modeHintTimer = setTimeout(() => {
      hint.style.opacity = '0';
    }, 2800);
  }

  // === 2. ФУНКЦИЯ СБОРКИ ИНТЕРФЕЙСА (ЗАПУСКАЕТСЯ ТОЛЬКО ПО КОМАНДЕ СЕРВЕРА) ===
  function initGameUI(settings) {
      savedSettings = settings;
      deckCount = settings.deck;

      // Настраиваем верхнюю панель живыми данными от сервера
      topGameBet.innerText = settings.deck;
      topGameModes.innerHTML = '';
      settings.modes.forEach(m => {
        const key = m.toLowerCase();
        const span = document.createElement('span');
        const desc = modeDescriptions[key] || m;
        span.innerText = modeEmojis[key] || '⚙️';
        span.title = desc;
        span.style.cursor = 'pointer';
        span.addEventListener('mouseenter', () => showModeHint(desc));
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          showModeHint(desc);
        });
        topGameModes.appendChild(span);
      });

      isCheaterMode = settings.modes.some(m => m.toLowerCase() === 'с шулерами');
      if (coinsDisplayEl) coinsDisplayEl.innerText = `${myCoins}🪙`;

      // Отрисовываем слоты ожидания на основе количества игроков из настроек
      renderWaitingSlots(settings.players);
      
      console.log("Интерфейс игры успешно собран по данным от сервера!");
  }

  // --- ФУНКЦИИ ОТРИСОВКИ КАРТ И СЛОТОВ ---
  function createCardElement(rank, suit, extraClass = '') {
    const isRed = suit === '♥' || suit === '♦';
    const colorClass = isRed ? 'card-red' : 'card-black';
    const card = document.createElement('div');
    card.className = `playing-card ${colorClass} ${extraClass}`;
    card.innerHTML = `
      <div class="card-corner top-left"><span class="card-rank">${rank}</span><span class="card-suit">${suit}</span></div>
      <div class="card-center">${suit}</div>
      <div class="card-corner bottom-right"><span class="card-rank">${rank}</span><span class="card-suit">${suit}</span></div>
    `;
    return card;
  }

  function renderAvatarHtml(avatar, name, fontSize = '18px') {
    const letter = name ? name[0].toUpperCase() : '?';
    if (avatar && avatar.startsWith('data:image')) {
      return `<img src="${avatar}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit; display:block;">`;
    }
    if (avatar && avatar.startsWith('emoji:')) {
      const emoji = avatar.replace('emoji:', '');
      return `<span style="font-size:${fontSize}; line-height:1;">${emoji}</span>`;
    }
    return `<span>${letter}</span>`;
  }

  // Генерируем слоты ожидания на основе переданного числа игроков
  function renderWaitingSlots(totalPlayers) {
    const oppCount = totalPlayers - 1; // Все минус мы сами
    oppArea.innerHTML = '';
    for(let i = 0; i < oppCount; i++) {
      oppArea.innerHTML += `
        <div class="opponent" id="opp-slot-${i}">
          <div class="avatar-box waiting">
            <span style="margin-top: 5px;">⏳</span>
            <div class="opp-name waiting">${isEn ? 'Waiting' : 'Ожидание'}</div>
          </div>
          <div class="opp-cards-fan" id="opp-fan-${i}"></div>
        </div>
      `;
    }
  }

  function updateOpponentCardsUI(oppToken, countRub) {
    const i = tokenToSlotMap[oppToken];
    if (i === undefined) return;

    const fan = document.getElementById(`opp-fan-${i}`);
    if (fan) {
      fan.innerHTML = `<div class="opp-card"></div>`.repeat(countRub);
      const centerOffset = (countRub - 1) / 2;
      Array.from(fan.children).forEach((card, idx) => {
        card.style.transform = `rotate(${(idx - centerOffset) * -12}deg) translateY(5px)`;
      });
    }

    const slot = document.getElementById(`opp-slot-${i}`);
    if (slot) {
      const countBadge = slot.querySelector('.opp-cards-count');
      if (countBadge) countBadge.innerText = countRub;
    }
  }

  window.showToast = function(message) {
    // Ищем, есть ли уже плашка уведомления на экране
    let toast = document.getElementById('game-toast');
    
    // Если плашки еще нет — создаем её программно и стилизуем
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'game-toast';
        toast.style.cssText = `
            position: absolute;
            top: 15%;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(26, 26, 27, 0.95);
            border: 1px solid var(--amber);
            color: var(--text);
            padding: 10px 20px;
            border-radius: 999px;
            font-size: 13px;
            font-weight: 700;
            z-index: 1000;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
            transition: opacity 0.3s ease, transform 0.3s ease;
            opacity: 0;
            pointer-events: none;
            text-align: center;
            white-space: nowrap;
        `;
        // Добавляем созданный тост внутрь игрового экрана .phone
        const phone = document.querySelector('.phone');
        if (phone) phone.appendChild(toast);
    }

    // Записываем текст сообщения
    toast.innerText = message;
    
    // Делаем тост видимым
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';

    // Сбрасываем старый таймер удаления, если уведомления спамят друг за другом
    clearTimeout(window.toastTimeout);

    // Через 2.5 секунды плавно гасим уведомление
    window.toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
    }, 2500);
};

  function renderHand() {
    handAnchor.innerHTML = '';
    const count = playerHandCards.length;
    const maxSpread = 260; 
    let stepX = count > 1 ? maxSpread / (count - 1) : 0;
    if (stepX > 45) stepX = 45; 
    let stepAngle = count > 1 ? 40 / (count - 1) : 0;
    if (stepAngle > 8) stepAngle = 8; 

    playerHandCards.forEach((cardObj, index) => {
      // Твой родной код создания и позиционирования карты
      const cardEl = createCardElement(cardObj[0], cardObj[1], 'hand-card hand-size');
      if (highlightEnabled) {
        const [r, s] = cardObj;
        let canPlay = false;
        if (currentTurnToken === userProfile.token) {
          if (tablePairs.length === 0) canPlay = true;
          else canPlay = tablePairs.some(p => p.atk[0] === r || (p.def && p.def[0] === r));
        } else if (currentDefenderToken === userProfile.token) {
          canPlay = tablePairs.some(p => !p.def && (
            (s === currentTrumpSuit && p.atk[1] !== currentTrumpSuit) ||
            (s === p.atk[1] && rankOrder[r] > rankOrder[p.atk[0]])
          ));
        }
        if (canPlay) {
          cardEl.style.boxShadow = '0 0 14px #2ecc71, 0 0 0 2px #2ecc71';
        }
      }
      const offset = index - (count - 1) / 2; 
      const tx = offset * stepX; 
      const rot = offset * stepAngle;
      const ty = Math.abs(offset) * Math.abs(offset) * (count > 10 ? 0.5 : 1.5); 
      
      cardEl.style.setProperty('--tx', `${tx}px`);
      cardEl.style.setProperty('--ty', `${ty}px`);
      cardEl.style.setProperty('--rot', `${rot}deg`);
      
      cardEl.style.zIndex = index + 1;

      // ========================================================
      // 🔥 МАГИЯ МОБИЛЬНОГО ТАСКАНИЯ КАРТЫ (ДЛЯ ТВОЕГО PYTHON СЕРВЕРА)
      // ========================================================

      // 1. ПАЛЕЦ НАЖАЛ НА КАРТУ
      cardEl.style.touchAction = 'none';

      // 1. НАЖАТИЕ (Палец прикоснулся или Мышка кликнула)
      cardEl.addEventListener('pointerdown', (e) => {
          draggedCard = cardEl;
          startX = e.clientX;
          startY = e.clientY;
          
          // Выводим карту на передний план и убираем анимацию CSS, чтобы не лагало
          cardEl.style.zIndex = '9999';
          cardEl.style.transition = 'none';

          // Заставляем карту следовать за указателем, даже если палец вылетит за её пределы
          cardEl.setPointerCapture(e.pointerId);
      });

      // 2. ПЕРЕМЕЩЕНИЕ (Тащим по экрану)
      cardEl.addEventListener('pointermove', (e) => {
          if (draggedCard !== cardEl) return;
          
          // Вычисляем смещение от начальной точки
          const moveX = e.clientX - startX;
          const moveY = e.clientY - startY;
          
          // Плавный сдвиг карты за пальцем/мышкой
          cardEl.style.transform = `translate(calc(var(--tx) + ${moveX}px), calc(var(--ty) + ${moveY}px)) rotate(0deg) scale(1.1)`;
      });

      // 3. ОТПУСКАНИЕ (Отпустили палец или кнопку мыши)
      cardEl.addEventListener('pointerup', (e) => {
          if (draggedCard !== cardEl) return;
          
          // Освобождаем перехват указателя
          cardEl.releasePointerCapture(e.pointerId);
          
          // Заглядываем под карту, чтобы узнать, куда её бросили
          cardEl.style.visibility = 'hidden';
          const elementUnderFinger = document.elementFromPoint(e.clientX, e.clientY);
          cardEl.style.visibility = 'visible';
          
          cardEl.style.transition = '';
          draggedCard = null;

          if (elementUnderFinger) {
            const hitCardPair = elementUnderFinger.closest('.card-pair');
            const hitBattleArea = elementUnderFinger.closest('#battle-area');

            // СЦЕНАРИЙ А: Защищаемся (кинули на карту стола)
            if (hitCardPair) {
                // Теперь здесь прочитается реальное число (0, 1 или 2), а не null!
                const pairIndex = parseInt(hitCardPair.getAttribute('data-index'), 10);
                
                // Достаем массив [ранг, масть] атакующей карты из глобального tablePairs
                const coveredCard = tablePairs[pairIndex] ? tablePairs[pairIndex].atk : null;

                console.log(`[JS] Отправляем defend_move для стола №${pairIndex}. Кроем карту:`, coveredCard);

                // Отправляем пакет на твой Python-сервер
                socket.emit('defend_move', {
                    card: cardObj,            // Твоя карта (массив [ранг, масть])
                    target_index: pairIndex,  // Числовой индекс стопки на столе
                    covered_card: coveredCard, // Карта, которую ты бьешь (массив [ранг, масть])
                    token: userProfile.token
                });
            }

              // СЦЕНАРИЙ Б: Атакуем (кинули просто на игровое поле)
              else if (hitBattleArea) {
                  console.log("[JS] Отправляем attack_move на сервер");
                  socket.emit('attack_move', {
                      card: cardObj,
                      token: userProfile.token
                  });
                  // УБРАЛИ return; чтобы код пошел дальше вниз
              }
          }

          // ТЕПЕРЬ КНОПКА СРАБАТЫВАЕТ ВСЕГДА!
          // Куда бы мы ни бросили карту — она мгновенно и аккуратно прыгнет обратно в руку.
          renderHand();
      });

      // ========================================================
      
      handAnchor.appendChild(cardEl);
    });
  }

  function renderTable() {
    battleArea.innerHTML = '';
    tablePairs.forEach((pair, index) => {
      const pairCont = document.createElement('div');
      pairCont.className = 'card-pair';
      pairCont.setAttribute('data-index', index);

      const atk = createCardElement(pair.atk[0], pair.atk[1], 'atk-card');
      atk.addEventListener('click', () => {
        if (isCheaterMode) {
          socket.emit('report_cheat_card', { token: userProfile.token, pair_index: index, role: 'atk' });
        }
      });
      pairCont.appendChild(atk);

      if (pair.def) {
        const def = createCardElement(pair.def[0], pair.def[1], 'def-card');
        def.addEventListener('click', () => {
          if (isCheaterMode) {
            socket.emit('report_cheat_card', { token: userProfile.token, pair_index: index, role: 'def' });
          }
        });
        pairCont.appendChild(def);
      }

      battleArea.appendChild(pairCont);
    });
  }

  // --- ЭМОДЗИ И ПОПАПЫ ---
  if (!document.getElementById('emote-anim-style')) {
    const style = document.createElement('style');
    style.id = 'emote-anim-style';
    style.textContent = `
      @keyframes emotePopUp {
        0%   { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.3); }
        18%  { opacity: 1; transform: translateX(-50%) translateY(-2px) scale(1.35); }
        32%  { opacity: 1; transform: translateX(-50%) translateY(0px) scale(1.15); }
        80%  { opacity: 1; transform: translateX(-50%) translateY(-2px) scale(1.15); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-14px) scale(0.85); }
      }
      @keyframes emotePopDown {
        0%   { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.3); }
        18%  { opacity: 1; transform: translateX(-50%) translateY(2px) scale(1.35); }
        32%  { opacity: 1; transform: translateX(-50%) translateY(0px) scale(1.15); }
        80%  { opacity: 1; transform: translateX(-50%) translateY(2px) scale(1.15); }
        100% { opacity: 0; transform: translateX(-50%) translateY(14px) scale(0.85); }
      }
      .avatar-emote-bubble {
        position: absolute;
        left: 50%;
        font-size: 32px;
        line-height: 1;
        pointer-events: none;
        z-index: 1450;
        filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.85));
      }
      .avatar-emote-bubble.from-me {
        bottom: calc(100% + 6px);
        animation: emotePopUp 2.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }
      .avatar-emote-bubble.from-opp {
        top: calc(100% + 8px);
        animation: emotePopDown 2.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }
    `;
    document.head.appendChild(style);
  }

  function showEmoteBubble(senderToken, emoji) {
    if (!appSettings.emotes || !emoji) return;

    const isMe = userProfile && senderToken === userProfile.token;
    let targetEl = null;

    if (isMe) {
      targetEl = document.querySelector('.player-profile');
    } else {
      const slotIndex = tokenToSlotMap[senderToken];
      if (slotIndex !== undefined) {
        targetEl = document.getElementById(`opp-slot-${slotIndex}`);
      }
    }

    if (!targetEl) return;
    if (getComputedStyle(targetEl).position === 'static') {
      targetEl.style.position = 'relative';
    }

    const oldBubble = targetEl.querySelector('.avatar-emote-bubble');
    if (oldBubble) oldBubble.remove();

    const bubble = document.createElement('div');
    bubble.className = `avatar-emote-bubble ${isMe ? 'from-me' : 'from-opp'}`;
    bubble.textContent = emoji;
    targetEl.appendChild(bubble);

    setTimeout(() => {
      bubble.remove();
    }, 2450);
  }

  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const popup = document.getElementById('emoji-popup');
      if (popup) popup.classList.remove('show');

      if (!appSettings.emotes || !userProfile) return;
      const emoji = btn.textContent.trim();
      if (!emoji) return;

      showEmoteBubble(userProfile.token, emoji);
      if (socket) {
        socket.emit('send_emote', {
          token: userProfile.token,
          emoji: emoji
        });
      }
    });
  });

  btnInvite.addEventListener('click', () => { invitePopup.classList.add('show'); });
  inviteClose.addEventListener('click', () => { invitePopup.classList.remove('show'); });

  // --- ИМИТАЦИЯ СТАРТА ИГРЫ (ОСТАВЛЯЕМ ДЛЯ ТЕСТОВ ИНТЕРФЕЙСА) ---
  

  // === 3. НАСТРОЙКА СЛУШАТЕЛЕЙ СЕТЕВЫХ СОБЫТИЙ СОКЕТА ===
  if(socket) {
      // При подключении отправляем запрос на авторизацию в комнате
      let turnTimerInterval = null;

      function updateTimerBadge(seconds, isMyTimer, phase) {
        let badge = document.getElementById('turn-timer-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.id = 'turn-timer-badge';
          badge.style.cssText = `
            position: absolute;
            top: 54px;
            left: 14px;
            background: rgba(26, 26, 27, 0.92);
            border: 1px solid var(--border);
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            z-index: 900;
            pointer-events: none;
            white-space: nowrap;
            transition: color 0.2s, border-color 0.2s;
          `;
          const phone = document.querySelector('.phone');
          if (phone) phone.appendChild(badge);
        }

        badge.style.display = 'block';
        let left = seconds;

        const renderTick = () => {
          const prefix = phase === 'finish_turn'
            ? (isEn ? '⏳ Ending turn: ' : '⏳ До конца кона: ')
            : (isMyTimer
                ? (isEn ? '⏱ Your turn: ' : '⏱ Твой ход: ')
                : (isEn ? '⏱ Opponent: ' : '⏱ Ход соперника: '));
          badge.innerText = `${prefix}${left}${isEn ? 's' : 'с'}`;

          if (left <= 5) {
            badge.style.color = '#e74c3c';
            badge.style.borderColor = '#e74c3c';
          } else if (isMyTimer) {
            badge.style.color = '#ffc107';
            badge.style.borderColor = '#ffc107';
          } else {
            badge.style.color = '#888';
            badge.style.borderColor = '#2a2a2c';
          }
        };

        renderTick();
        clearInterval(turnTimerInterval);
        turnTimerInterval = setInterval(() => {
          left--;
          if (left <= 0) {
            clearInterval(turnTimerInterval);
            left = 0;
          }
          renderTick();
        }, 1000);
      }

      socket.on('timer_update', function(data) {
        clearInterval(turnTimerInterval);
        const badge = document.getElementById('turn-timer-badge');
        if (!data.active) {
          if (badge) badge.style.display = 'none';
          return;
        }
        const isMyTimer = data.target_token === userProfile.token;
        updateTimerBadge(data.seconds, isMyTimer, data.phase);
      });

      socket.on('coins_updated', function(data) {
        myCoins = data.coins;
        if (coinsDisplayEl) coinsDisplayEl.innerText = `${myCoins}🪙`;
        if (userProfile) {
          userProfile.gold = myCoins;
          localStorage.setItem('durak_user_profile', JSON.stringify(userProfile));
        }
      });

      socket.on('receive_emote', function(data) {
        if (!appSettings.emotes) return;
        showEmoteBubble(data.sender_token, data.emoji);
      });

      socket.on('player_passed_bito', function(data) {
        const rawAct = data.action || 'Бито';
        const act = isEn ? (rawAct === 'Пас' ? 'Pass' : 'Bito') : rawAct;
        showToast(isEn ? `✅ ${data.name} pressed "${act}"` : `✅ ${data.name} нажал «${act}»`);
      });

      socket.on('defender_taking', function(data) {
        if (data.defender_token === userProfile.token) {
          showToast(isEn ? 'You chose to take cards. Waiting for throw-ins...' : 'Вы решили взять карты. Ждём, пока соперники подкинут...');
        } else {
          showToast(isEn ? `📥 ${data.defender_name} is taking! Throw in or press "Pass"` : `📥 ${data.defender_name} берёт! Подкиньте карты или нажмите «Пас»`);
        }
      });

      socket.on('highlight_enabled', function() {
        highlightEnabled = true;
        if (actionItems[2]) {
          const box = actionItems[2].querySelector('.action-btn-white');
          if (box) box.style.border = '2px solid #2ecc71';
        }
        renderHand();
        showToast(isEn ? '🔍 Card highlight enabled for the match!' : '🔍 Подсветка карт включена до конца игры!');
      });

      socket.on('discard_pile_data', function(data) {
        let box = document.getElementById('discard-overlay');
        if (box) box.remove();

        box = document.createElement('div');
        box.id = 'discard-overlay';
        box.style.cssText = `
          position: absolute; top: 20%; left: 50%; transform: translateX(-50%);
          width: 86%; max-height: 45%; overflow-y: auto;
          background: rgba(20, 20, 22, 0.96); border: 1px solid var(--amber);
          border-radius: 16px; padding: 12px; z-index: 1500;
          box-shadow: 0 10px 30px rgba(0,0,0,0.85);
        `;
        const title = data.cards.length
  ? (isEn ? `👁️ Discard (${data.cards.length} cards):` : `👁️ Отбой (${data.cards.length} карт):`)
  : (isEn ? '👁️ Discard pile is empty' : '👁️ В отбое пока пусто');
        box.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:12px; font-weight:700; color:var(--amber);">${title}</span>
          <button onclick="this.closest('#discard-overlay').remove()" style="background:none; border:none; color:#fff; font-size:16px; cursor:pointer;">✖</button>
        </div>`;

        const grid = document.createElement('div');
        grid.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; justify-content:center;';
        data.cards.forEach(c => {
          const el = createCardElement(c[0], c[1]);
          el.style.position = 'relative';
          el.style.transform = 'scale(0.75)';
          el.style.margin = '-10px -8px';
          grid.appendChild(el);
        });
        box.appendChild(grid);
        document.querySelector('.phone').appendChild(box);
      });

      socket.on('table_synced', function(data) {
        tablePairs = data.table_pairs;
        renderTable();
        playerHandCards = sortPlayerHand(data.your_cards);
        renderHand();

        if (data.players_cards_count) {
          Object.entries(data.players_cards_count).forEach(([tok, count]) => {
            if (tok !== userProfile.token) updateOpponentCardsUI(tok, count);
          });
        }
      });

      socket.on('cheat_exposed', function(data) {
        const isMe = data.cheater_token === userProfile.token;
        if (data.status === 'caught') {
          showToast(isMe
            ? (isEn ? '🚨 You were caught cheating! Cards returned, no more cheating' : '🚨 Тебя поймали на шулерстве! Карты вернулись, жульничать больше нельзя')
            : (isEn ? `🚨 ${data.cheater_name} was caught cheating!` : `🚨 ${data.cheater_name} пойман на шулерстве!`)
          );
        } else {
          showToast(isMe
            ? (isEn ? '🚨 That card was fair! False report marks you as a cheater' : '🚨 Карта была честной! За ложный донос ты помечен как шулер')
            : (isEn ? `🚨 ${data.cheater_name} made a false call and is marked as a cheater!` : `🚨 ${data.cheater_name} ошибся с проверкой и помечен как шулер!`)
          );
        }
      });

      socket.on('room_closed', function(data) {
        gameInProgress = false;
        showToast(data.message || 'Комната закрыта');
        setTimeout(() => {
          if (socket) socket.disconnect();
          window.location.replace('/');
        }, 1200);
      });

      socket.on('turn_finished', function(data) {
        // 1. Очищаем стол
        tablePairs = [];
        renderTable();

        // 2. Прячем кнопку действия
        mainBtn.style.opacity = '0';
        mainBtn.style.pointerEvents = 'none';

        // 3. Обновляем свои карты и остаток колоды
        currentTurnToken = data.turn_token;
        currentDefenderToken = data.defender_token;
        playerHandCards = sortPlayerHand(data.your_cards);
        renderHand();

        cardsLeftEl.innerText = data.deck_count;
        if (data.deck_count === 0) {
          const stack = deckArea.querySelector('.deck-stack');
          if (stack) stack.style.opacity = '0';
          cardsLeftEl.style.opacity = '0';

          const trumpContainer = document.getElementById('trump-container');
          const isRed = currentTrumpSuit === '♥' || currentTrumpSuit === '♦';
          trumpContainer.style.transform = 'none';
          trumpContainer.style.left = '55px';
          trumpContainer.style.top = '30px';
          trumpContainer.innerHTML = `
            <div style="
              width: 44px; height: 44px;
              display: flex; align-items: center; justify-content: center;
              font-size: 34px; opacity: 0.4;
              color: ${isRed ? '#e74c3c' : '#f0f0f0'};
            ">${currentTrumpSuit}</div>
          `;
        }

        // 4. Обновляем количество карт у соперников
        if (data.players_cards_count) {
          Object.entries(data.players_cards_count).forEach(([tok, count]) => {
            if (tok !== userProfile.token) {
              updateOpponentCardsUI(tok, count);
            }
          });
        }
        if (data.your_coins !== undefined) {
          myCoins = data.your_coins;
          if (coinsDisplayEl) coinsDisplayEl.innerText = `${myCoins}🪙`;
          if (userProfile) {
            userProfile.gold = myCoins;
            localStorage.setItem('durak_user_profile', JSON.stringify(userProfile));
          }
        }

        // 5. Проверяем победу или переключаем подсветку хода
        if (data.winners && data.winners.length > 0) {
          matchEndedCleanly = true;
          gameInProgress = false;
          clearInterval(turnTimerInterval);
          const badge = document.getElementById('turn-timer-badge');
          if (badge) badge.style.display = 'none';
          document.querySelector('.player-profile').classList.remove('active-turn');

          const iWon = data.winners.includes(userProfile.token);
          if (data.reason === 'surrender') {
            showToast(iWon
              ? (isEn ? `🏳️ ${data.leaver_name} surrendered! Win +1 🪙` : `🏳️ ${data.leaver_name} сдался! Победа +1 🪙`)
              : (isEn ? '🏳️ You surrendered' : '🏳️ Вы сдались'));
          } else if (data.reason === 'left') {
            showToast(isEn ? `🚪 ${data.leaver_name} left! Win +1 🪙` : `🚪 ${data.leaver_name} покинул игру! Победа +1 🪙`);
          } else if (data.is_draw) {
            showToast(isEn ? '🤝 Draw! Both ran out of cards' : '🤝 Ничья! Карты закончились одновременно');
          } else {
            showToast(iWon
              ? (isEn ? '🏆 Victory! +1 🪙' : '🏆 Победа! +1 🪙')
              : (isEn ? '💀 You are the Durak!' : '💀 Вы остались в дураках!'));
          }

          showBackToMenuButton();
          return;
        }

        if (data.turn_token === userProfile.token) {
          showToast(isEn
            ? (data.reason === 'take' ? 'Opponent took cards! Your turn again' : 'Bito! Your turn')
            : (data.reason === 'take' ? 'Соперник взял! Снова твой ход' : 'Бито! Твой ход'));
          document.querySelector('.player-profile').classList.add('active-turn');
        } else {
          showToast(isEn
            ? (data.reason === 'take' ? "You took the cards. Opponent's turn" : "Bito! Opponent's turn")
            : (data.reason === 'take' ? 'Ты забрал карты. Ход соперника' : 'Бито! Ход соперника'));
          document.querySelector('.player-profile').classList.remove('active-turn');
        }
      });

      socket.on('turn_transferred', function(data) {
        if (data.new_defender_token === userProfile.token) {
          showToast(isEn ? `🔄 ${data.from_name} transferred to you! Defend` : `🔄 ${data.from_name} перевёл на тебя! Отбивайся`);
          document.querySelector('.player-profile').classList.add('active-turn');
        } else if (data.new_attacker_token === userProfile.token) {
          showToast(isEn ? '🔄 You transferred the attack!' : '🔄 Ты перевёл ход!');
          document.querySelector('.player-profile').classList.remove('active-turn');
        } else {
          showToast(isEn ? `🔄 ${data.from_name} transferred the cards further` : `🔄 ${data.from_name} перевёл карты дальше`);
          document.querySelector('.player-profile').classList.remove('active-turn');
        }
        currentTurnToken = data.new_attacker_token;
        currentDefenderToken = data.new_defender_token;
        renderHand();
      });

      socket.on('connect', () => {
        if (userProfile) {
            const rawData = localStorage.getItem('temp_match_data');
            
            // Базовый пакет, который отправляют абсолютно ВСЕ
            let sendData = {
                token: userProfile.token,
                prof: userProfile
            };

            // Если в памяти есть данные — значит это ГОСТЬ пришел по приглашению
            if (rawData !== null) {
                const roomData = JSON.parse(rawData);
                localStorage.removeItem('temp_match_data'); // Стираем кэш только у гостя
                
                // Дописываем гостю токен его хоста
                sendData.host_token = roomData.host_token;
                console.log("Зашел гость, передаем токен хоста:", sendData.host_token);
            } else {
                console.log("Зашел создатель (или переподключение), сервер сам найдет комнату.");
            }
            
            // Отправляем один чистый пакет на сервер
            socket.emit('player_ready_in_game', sendData);
            socket.emit('auth', userProfile);
            
        } else {
            window.location.replace('/');
        }
      
    });

      mainBtn.addEventListener('click', () => {
        const actionText = mainBtn.innerText.trim();

        if (actionText === 'Готово' || actionText === 'Ready') {
          if (!savedSettings) return;
          socket.emit('player_ready_to_start', { token: userProfile.token });
          mainBtn.innerText = isEn ? 'Waiting...' : 'Ожидание...';
          mainBtn.style.opacity = '0.6';
          mainBtn.style.pointerEvents = 'none';
        } 
        else if (['Бито', 'Пас', 'Bito', 'Pass'].includes(actionText)) {
          socket.emit('bito_move', { token: userProfile.token });
          mainBtn.style.opacity = '0';
          mainBtn.style.pointerEvents = 'none';
        } 
        else if (actionText === 'Взять' || actionText === 'Take') {
          socket.emit('take_move', { token: userProfile.token });
          mainBtn.style.opacity = '0';
          mainBtn.style.pointerEvents = 'none';
        }
      });

      socket.on('game_started', function(data) {
        gameInProgress = true;
        console.log(data);

        if (data.coins !== undefined) {
          myCoins = data.coins;
          if (coinsDisplayEl) coinsDisplayEl.innerText = `${myCoins}🪙`;
          if (userProfile) {
            userProfile.gold = myCoins;
            localStorage.setItem('durak_user_profile', JSON.stringify(userProfile));
          }
        }

        btnInvite.classList.add('hidden');
        invitePopup.classList.remove('show');
        

        mainBtn.innerText = 'Беру'; // Или "Пасс" / "Бито" в зависимости от логики хода
        mainBtn.className = 'btn-action danger';
        mainBtn.style.opacity = '0';
        mainBtn.style.pointerEvents = 'none';

        deckArea.style.opacity = '1';
        cardsLeftEl.innerText = data.deck_count;

        const trumpContainer = document.getElementById('trump-container');
        trumpContainer.style.left = '';
        trumpContainer.style.top = '';
        trumpContainer.innerHTML = '';
        trumpContainer.style.transform = '';
        currentTrumpSuit = data.trump_card[1];
        const stack = deckArea.querySelector('.deck-stack');
        if (stack) stack.style.opacity = '1';
        cardsLeftEl.style.opacity = '1';

        const trumpCardEl = createCardElement(data.trump_card[0], data.trump_card[1]);
        trumpContainer.appendChild(trumpCardEl);

        const oppCount = savedSettings ? savedSettings.players - 1 : 0;
        for (let i = 0; i < oppCount; i++) {
            const fan = document.getElementById(`opp-fan-${i}`);
            if (fan) {
                // Генерируем 6 визуальных рубашек для i-го соперника
                fan.innerHTML = `
                    <div class="opp-card"></div><div class="opp-card"></div>
                    <div class="opp-card"></div><div class="opp-card"></div>
                    <div class="opp-card"></div><div class="opp-card"></div>
                `;
                
                // Красиво раскладываем их веером (твой родной код анимации)
                Array.from(fan.children).forEach((card, idx) => {
                    card.style.transform = `rotate(${(idx - 2.5) * -12}deg) translateY(5px)`;
                });
            }
            
            // На всякий случай обновляем счетчик карт в аватарке соперника
            const slot = document.getElementById(`opp-slot-${i}`);
            if (slot) {
                const countBadge = slot.querySelector('.opp-cards-count');
                if (countBadge) countBadge.innerText = '6';
            }
        }
        currentTurnToken = data.turn_token;
        currentDefenderToken = data.defender_token;
        playerHandCards = sortPlayerHand(data.your_cards);
        renderHand();

        if (data.turn_token === userProfile.token) {
          showToast(isEn ? '⚡ Your turn!' : '⚡ Твой ход, ходи!');
          document.querySelector('.player-profile').classList.add('active-turn');
        } else {
          showToast(isEn ? "Waiting for opponent's move..." : 'Ожидаем ход соперника...');
          document.querySelector('.player-profile').classList.remove('active-turn');
        }
      });

      socket.on('table_updated', function(data) {
        const newPair = data.table_pairs[0];

        // Проверяем: это карта защиты (ею кроют)?
        if (newPair.def !== null) {
            // Ищем индекс уже лежащей на столе пары, у которой совпадает атакующая карта [ранг, масть]
            const existingIndex = tablePairs.findIndex(p => 
                p.atk[0] === newPair.atk[0] && p.atk[1] === newPair.atk[1]
            );

            if (existingIndex !== -1) {
                // Если нашли совпадение — заменяем старую пару на новую (где теперь есть деф)
                tablePairs[existingIndex] = newPair;
            } else {
                // Страховка: если почему-то в массиве не нашлось (хотя должно), просто добавляем
                tablePairs.push(newPair);
            }
        } else {
            // Если это новая атака (def равен null), то просто кидаем новую пару на стол
            tablePairs.push(newPair);
        }

        renderTable()
        tokens = data.attacker_token
        i = tokenToSlotMap[tokens]
        console.log(tokens, tokenToSlotMap, i)
        count_rub = data.cards_left_in_hand

        const fan = document.getElementById(`opp-fan-${i}`); //
        if (fan) {
            // 1. Динамически генерируем HTML-строку рубашек ровно count_rub раз
            fan.innerHTML = `<div class="opp-card"></div>`.repeat(count_rub); //
            
            // 2. Вычисляем идеальный центр веера для любого количества карт
            // (например, для 5 карт центр будет: (5 - 1) / 2 = 2)
            const centerOffset = (count_rub - 1) / 2;
            
            // Раскладываем созданные карты веером
            Array.from(fan.children).forEach((card, idx) => {
                // Вместо 2.5 подставляем наш динамический centerOffset
                card.style.transform = `rotate(${(idx - centerOffset) * -12}deg) translateY(5px)`; //
            });
        }
        
        // 3. Обновляем числовой счетчик на аватарке соперника
        const slot = document.getElementById(`opp-slot-${i}`); //[cite: 2]
        if (slot) {
            const countBadge = slot.querySelector('.opp-cards-count'); //
            if (countBadge) {
                countBadge.innerText = count_rub; // Подставляем значение из переменной!
            }
        }
        console.log(tokenToSlotMap)
        if (highlightEnabled) renderHand();
      })

      socket.on('cards_updated', function(data) {
        playerHandCards = sortPlayerHand(data);
        renderHand();
      })

      // Ловим настройки нашей комнаты от сервера
      socket.on('init_game_data', function(serverSettings) {
          console.log("Данные игры успешно получены от сервера:", serverSettings);
          initGameUI(serverSettings);
      });

      socket.on('frend_connect', function(players) {
        console.log("Обновленный список соперников от сервера:", players);

        tokenToSlotMap = {}; // очищаем
        players.forEach((player, index) => {
            if (player) {
                tokenToSlotMap[player.token] = index; // Запоминаем: этот токен = этот слот
            }
        });
        
        // 1. Сначала объявляем константы для расчетов количества мест
        const totalPlayersNeeded = savedSettings ? parseInt(savedSettings.players, 10) : 0;
        const oppCount = totalPlayersNeeded > 0 ? totalPlayersNeeded - 1 : 0;
        
        // 2. ВАЖНО: Объявляем счетчик живых игроков ТУТ (до цикла!)
        let connectedCount = 0;

        // 3. Запускаем цикл проверки слотов на экране
        for (let i = 0; i < oppCount; i++) {
            const slot = document.getElementById(`opp-slot-${i}`);
            if (!slot) continue;

            const avatarBox = slot.querySelector('.avatar-box');
            
            
            if (players[i]) {
                // Игрок на месте — увеличиваем счетчик, созданный на шаге 2
                connectedCount++; 
                
                const player = players[i];
                const firstLetter = player.name ? player.name[0].toUpperCase() : '?';

                avatarBox.classList.remove('waiting');
                avatarBox.style.background = '#c29d89';
                avatarBox.style.borderColor = '#e74c3c';
                avatarBox.innerHTML = `
                    <div style="width:100%; height:100%; border-radius:inherit; overflow:hidden; display:flex; align-items:center; justify-content:center;">
                        ${renderAvatarHtml(player.avatar, player.name, '20px')}
                    </div>
                    <div class="opp-cards-count">6</div>
                    <div class="opp-name">${player.name}</div>
                `;
            } else {
                // Игрока для этого слота еще нет
                avatarBox.classList.add('waiting');
                avatarBox.style.background = ''; 
                avatarBox.style.borderColor = '';
                avatarBox.innerHTML = `
                    <span style="margin-top: 5px;">⏳</span>
                    <div class="opp-name waiting">Ожидание</div>
                `;
            }
        }

        // 4. Логи в консоль для проверки (теперь connectedCount точно определен)
        console.log(`[ДЕБАГ] Подключено: ${connectedCount}, Нужно всего: ${oppCount}`);

        // 5. Условие появления кнопки "Готово"
        if (connectedCount === oppCount && oppCount > 0) {
            mainBtn.innerText = isEn ? 'Ready' : 'Готово';
            mainBtn.classList.remove('hidden'); 
        } else {
            mainBtn.classList.add('hidden'); 
        }
    });
    
    socket.on('bery_off_on', function(data) {
      if (data) {
        mainBtn.innerText = isEn ? 'Take' : 'Взять';
        mainBtn.className = 'btn-action danger';
        mainBtn.style.opacity = '1';
        mainBtn.style.pointerEvents = 'all';
      } else if (mainBtn.innerText === 'Взять' || mainBtn.innerText === 'Take') {
        mainBtn.style.opacity = '0';
        mainBtn.style.pointerEvents = 'none';
      }
    });

    socket.on('bito_off_on', function(data) {
      const show = typeof data === 'object' ? data.show : Boolean(data);
      const rawLabel = (typeof data === 'object' && data.text) ? data.text : 'Бито';
      const label = isEn ? (rawLabel === 'Пас' ? 'Pass' : 'Bito') : rawLabel;

      if (show) {
        mainBtn.innerText = label;
        mainBtn.className = 'btn-action danger';
        mainBtn.style.opacity = '1';
        mainBtn.style.pointerEvents = 'all';
      } else if (['Бито', 'Пас', 'Bito', 'Pass'].includes(mainBtn.innerText.trim())) {
        mainBtn.style.opacity = '0';
        mainBtn.style.pointerEvents = 'none';
      }
    });

      // Ловим список друзей для приглашения (Твоя исправленная логика в один цикл)
      socket.on('frend_res', function(playersList) { 
          const container = document.querySelector('.invite-list');
          if (!container) return;
          container.innerHTML = '';

          const otherPlayers = (playersList || []).filter(
              player => player && (!userProfile || player.token !== userProfile.token)
          );

          if (otherPlayers.length === 0) {
              container.innerHTML = `
                  <div style="text-align:center; color:var(--text-muted); font-size:12px; padding:16px 8px;">
                      ${isEn ? 'No other players online' : 'В сети пока никого нет'}
                  </div>
              `;
              return;
          }

          otherPlayers.forEach(player => { 
              const playerElement = document.createElement('div');
              playerElement.className = 'invite-item'; 
              
              const firstLetter = player.name ? player.name[0].toUpperCase() : '?';
              
              playerElement.innerHTML = `
                  <div style="display:flex; align-items:center; gap:12px;">
                    <div class="invite-avatar" style="border-color: var(--amber); color: var(--amber); overflow: hidden;">
                        ${renderAvatarHtml(player.avatar, player.name, '16px')}
                    </div>
                    <div class="invite-name">${player.name}</div>
                  </div>
                  <button class="invite-add-btn">➕</button>
              `;
              
              // Настраиваем кнопку отправки инвайта прямо внутри цикла создания
              const btn = playerElement.querySelector('.invite-add-btn');
              
              btn.addEventListener('click', function() {
                  if (this.classList.contains('invited')) {
                      this.classList.remove('invited');
                      this.innerText = '➕';
                  } else {
                      this.classList.add('invited');
                      this.innerText = '✓';
                      
                      // Отправляем пакет: Кто приглашает, ставка текущей комнаты и Кому летит инвайт
                      socket.emit('invite_room', {
                          from_token: userProfile.token,
                          from_name: userProfile.name,
                          from_money: savedSettings ? `${savedSettings.deck} карт` : '36 карт',
                          from_avatar: userProfile.avatar,
                          to_token: player.token 
                      });
                      
                      console.log(`Отправлено приглашение для ${player.name} (токен: ${player.token})`);
                  }
              });

              container.appendChild(playerElement);
          });
      });
  }
});

// --- ГЛОБАЛЬНЫЕ ВНЕШНИЕ ФУНКЦИИ-ЗАГЛУШКИ ---
window.frends_lst = function() {
  if(socket) socket.emit('frends_l');
};

window.sendGameInvite = function(token) {
    console.log("Отправлено приглашение игроку с токеном: " + token);
};