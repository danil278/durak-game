const state = { gold: 12400, cash: 240, settings: {} };

/* ── SCREEN TRANSITIONS ── */
function openSettings() { switchScreen('screen-menu', 'screen-settings'); }
function closeSettings() { switchScreenBack('screen-settings', 'screen-menu'); }
function openCreate() { switchScreen('screen-menu', 'screen-create'); }
function closeCreate() { switchScreenBack('screen-create', 'screen-menu'); }

// НОВЫЕ ФУНКЦИИ ДЛЯ ЭКРАНА ДРУЗЕЙ
function openFriends() {
    switchScreen('screen-menu', 'screen-friends');
    sendMenuAuth();
}
function closeFriends() { switchScreenBack('screen-friends', 'screen-menu'); }

function switchScreen(fromId, toId) {
    const from = document.getElementById(fromId);
    const to = document.getElementById(toId);
    from.classList.add('slide-left');
    setTimeout(() => { from.classList.remove('active','slide-left'); }, 60);
    to.classList.add('active');
    to.scrollTop = 0;
}
function switchScreenBack(fromId, toId) {
    const from = document.getElementById(fromId);
    const to = document.getElementById(toId);
    from.style.transform = 'translateX(30px)';
    from.style.opacity   = '0';
    setTimeout(() => {
        from.classList.remove('active');
        from.style.transform = '';
        from.style.opacity   = '';
    }, 280);
    to.classList.add('active');
}

/* ── CREATE GAME LOGIC ── */
const betValues = ['100', '1K', '10K', '100K', '1M', '10M'];
function updateBet(index) {
    document.getElementById('bet-display').textContent = betValues[index] + ' 💵';
}

function selectSeg(btn, type) {
    // Убираем активный класс у кнопок в этом блоке
    btn.closest('.seg-ctrl').querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Если выбрали 2 игроков, отключаем режим "Все" и ставим "Соседи"
    if (type === 'players' && btn.innerText === '2') {
        const vseCard = document.querySelector('.mode-card[data-val="vse"]');
        if (vseCard.classList.contains('active')) {
            vseCard.classList.remove('active');
            document.querySelector('.mode-card[data-val="sosedi"]').classList.add('active');
            showToast(tMenu('toast_vse_off'));
        }
    }
}

function selectMode(card) {
    const group = card.getAttribute('data-group');
    const value = card.getAttribute('data-val');

    // Правило: нельзя выбрать "Все", если стоит 2 игрока
    if (value === 'vse') {
        const activePlayers = document.querySelector('#players-seg .seg-btn.active').innerText;
        if (activePlayers === '2') {
            showToast(tMenu('toast_vse_unavail'));
            return; // Прерываем выполнение, кнопка не нажмется
        }
    }

    // Снимаем выделение у другой кнопки из этой же пары (по data-group)
    document.querySelectorAll(`.mode-card[data-group="${group}"]`).forEach(el => {
        el.classList.remove('active');
    });

    // Активируем ту, на которую нажали
    card.classList.add('active');
}

function toggleCheck(label) {
    const box = label.querySelector('.check-box');
    box.classList.toggle('checked');
}

// Если вдруг понадобится скачивать настройки в реальный .txt файл
// function downloadSettingsFile(settings) {
//     const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings, null, 2));
//     const dlAnchorElem = document.createElement('a');
//     dlAnchorElem.setAttribute("href",     dataStr);
//     dlAnchorElem.setAttribute("download", "game_settings.txt");
//     dlAnchorElem.click();
// }

/* ── MISC ── */


function logSetting(key, value) { state.settings[key] = value; }

let toastTimer;
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

let userProfile = JSON.parse(localStorage.getItem('durak_user_profile'));

if (!userProfile) {
    // 2. Если профиля нет, создаем новый уникальный токен
    const newToken = 'id_' + Math.random().toString(36).substr(2, 9) + Date.now();
    userProfile = {
        token: newToken,
        name: "Игрок_" + newToken.substr(3, 4),
        sid: "",
        gold: 5, // Стартовый капитал
        avatar: "default.png"
    };
    // Сохраняем его в память браузера
    localStorage.setItem('durak_user_profile', JSON.stringify(userProfile));
}
// Функция вызова таблички
// Пример использования: showInviteModal('Oleg', '5K');
function showInviteModal(playerName, betAmount, hostToken, hostAvatar) {
    const overlay = document.getElementById('invite-request-overlay');

    document.getElementById('invite-req-name').textContent = playerName;
    const reqAvatarEl = document.getElementById('invite-req-avatar');
    reqAvatarEl.style.overflow = 'hidden';
    reqAvatarEl.innerHTML = renderAvatarHtml(hostAvatar, playerName, '18px');
    
    // 1. Подставляем данные в HTML
    const badgeEl = document.getElementById('invite-req-info-badge');
    if (badgeEl) {
        if (betAmount && appSettings.lang === 'en') {
            badgeEl.textContent = betAmount.replace('карт', 'cards');
        } else {
            badgeEl.textContent = betAmount || tMenu('local_match');
        }
    }
    
    // 2. Находим кнопки "Принять" и "Отклонить" внутри этого окна
    // (Убедись, что дал им такие id в HTML, или замени на свои классы)
    const acceptBtn = document.getElementById('invite-accept-btn');
    const declineBtn = document.getElementById('invite-decline-btn');
    
    // 3. Настраиваем кнопку "ПРИНЯТЬ" прямо здесь! Переменная hostToken тут доступна
    acceptBtn.onclick = function() {
        overlay.classList.remove('show'); // Скрываем окно
        console.log("Вы приняли приглашение в игру хоста:", hostToken);
        showToast(tMenu('toast_joined'));
        

        localStorage.setItem('temp_match_data', JSON.stringify({
            host_token: hostToken,
            token: userProfile.token,
            prof: userProfile
        }));
                
        // Переходим на страницу игры (как мы договорились — на чистый URL)
        window.location.replace('/game');
    };
    
    // 4. Настраиваем кнопку "ОТКЛОНИТЬ"
    declineBtn.onclick = function() {
        overlay.classList.remove('show'); // Скрываем окно
        console.log("Вы отклонили приглашение от:", hostToken);
        showToast(tMenu('toast_declined'));
        
        // Говорим серверу, чтобы он сообщил хосту об отказе
        socket.emit('decline_invite', {
            host_token: hostToken
        });
    };
    
    // 5. Показываем окно
    overlay.classList.add('show');
}

// --- НАСТРОЙКИ ПРИЛОЖЕНИЯ И ЯЗЫК ---
const defaultAppSettings = {
    sortCards: true,
    emotes: true,
    lang: 'ru'
};

let appSettings = JSON.parse(localStorage.getItem('durak_app_settings')) || { ...defaultAppSettings };

const MENU_I18N = {
    ru: {
        player_label: 'Игрок',
        menu_label: 'Меню',
        create_game: 'Создать игру',
        friends_online: 'Игроки в сети',
        settings_title: 'Настройки',
        rules_title: 'Правила',
        rules_soon: '📖 Раздел правил скоро появится',
        connected_hotspot: 'Подключены к точке доступа',
        settings_gameplay: 'Игровой процесс',
        opt_sort_title: 'Сортировка карт',
        opt_sort_desc: 'По мастям, козыри справа',
        opt_emotes_title: 'Смайлики в игре',
        opt_emotes_desc: 'Показывать эмоции за столом',
        settings_lang: 'Язык интерфейса',
        players_count: 'Игроки',
        deck_size: 'Колода',
        game_speed: 'Скорость',
        game_modes: 'Режимы игры',
        start_btn: 'Создать ▶',
        mode_podkidnoy: 'подкидной',
        mode_sosedi: 'соседи',
        mode_shulera: 'с шулерами',
        mode_klassika: 'классика',
        mode_perevodnoy: 'переводной',
        mode_vse: 'все',
        mode_chestnaya: 'честная',
        mode_nichya: 'ничья',
        profile_modal_title: 'Профиль игрока',
        upload_photo: '📷 Загрузить фото',
        choose_icon: 'Или выбери иконку',
        nickname_label: 'Никнейм',
        enter_name_ph: 'Введи имя',
        cancel_btn: 'Отмена',
        save_btn: 'Сохранить',
        invite_header: 'Вам бросили вызов!',
        invite_sub: 'приглашает вас за стол',
        local_match: 'Локальный матч',
        no_btn: 'Нет',
        yes_btn: 'Да',
        you_tag: '(Вы)',
        online_status: '● В сети',
        toast_vse_off: 'Режим «Все» отключён для 2 игроков',
        toast_vse_unavail: 'Режим «Все» недоступен для 2 игроков!',
        toast_joined: '✅ Вы присоединились к игре!',
        toast_declined: '❌ Приглашение отклонено',
        toast_coins_info: '🏆 Монеты начисляются за победы (+1 🪙)',
        toast_zero_bonus: '🪙 Бонус за пустой кошелёк: +1',
        toast_profile_saved: '✅ Профиль обновлён'
    },
    en: {
        player_label: 'Player',
        menu_label: 'Menu',
        create_game: 'Create Game',
        friends_online: 'Players Online',
        settings_title: 'Settings',
        rules_title: 'Rules',
        rules_soon: '📖 Rules section coming soon',
        connected_hotspot: 'Connected to hotspot',
        settings_gameplay: 'Gameplay',
        opt_sort_title: 'Sort Cards',
        opt_sort_desc: 'By suit, trumps on the right',
        opt_emotes_title: 'In-Game Emotes',
        opt_emotes_desc: 'Show reactions at the table',
        settings_lang: 'Language',
        players_count: 'Players',
        deck_size: 'Deck',
        game_speed: 'Speed',
        game_modes: 'Game Modes',
        start_btn: 'Create ▶',
        mode_podkidnoy: 'throw-in',
        mode_sosedi: 'neighbors',
        mode_shulera: 'cheaters',
        mode_klassika: 'classic',
        mode_perevodnoy: 'transfer',
        mode_vse: 'all',
        mode_chestnaya: 'fair play',
        mode_nichya: 'draw',
        profile_modal_title: 'Player Profile',
        upload_photo: '📷 Upload photo',
        choose_icon: 'Or choose an icon',
        nickname_label: 'Nickname',
        enter_name_ph: 'Enter name',
        cancel_btn: 'Cancel',
        save_btn: 'Save',
        invite_header: "You've been challenged!",
        invite_sub: 'invites you to the table',
        local_match: 'Local match',
        no_btn: 'No',
        yes_btn: 'Yes',
        you_tag: '(You)',
        online_status: '● Online',
        toast_vse_off: '"All" mode disabled for 2 players',
        toast_vse_unavail: '"All" mode is unavailable for 2 players!',
        toast_joined: '✅ You joined the game!',
        toast_declined: '❌ Invitation declined',
        toast_coins_info: '🏆 Coins are awarded for wins (+1 🪙)',
        toast_zero_bonus: '🪙 Empty wallet bonus: +1',
        toast_profile_saved: '✅ Profile updated'
    }
};

function tMenu(key) {
    const lang = appSettings.lang || 'ru';
    return (MENU_I18N[lang] && MENU_I18N[lang][key]) || MENU_I18N.ru[key] || key;
}

function saveAppSettings() {
    localStorage.setItem('durak_app_settings', JSON.stringify(appSettings));
}

function renderSwitchState(btn, isOn) {
    if (!btn) return;
    btn.classList.toggle('active', isOn);
    btn.style.background = isOn ? 'var(--emerald)' : '#333336';
    const knob = btn.querySelector('span');
    if (knob) knob.style.left = isOn ? '23px' : '3px';
}

function applyMenuLanguage() {
    const lang = appSettings.lang || 'ru';

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (MENU_I18N[lang] && MENU_I18N[lang][key]) {
            el.textContent = MENU_I18N[lang][key];
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (MENU_I18N[lang] && MENU_I18N[lang][key]) {
            el.placeholder = MENU_I18N[lang][key];
        }
    });

    document.querySelectorAll('#lang-seg .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });
}

// Инициализация переключателей настроек
const sortToggleBtn = document.getElementById('toggle-sort-cards');
const emotesToggleBtn = document.getElementById('toggle-emotes');

renderSwitchState(sortToggleBtn, appSettings.sortCards);
renderSwitchState(emotesToggleBtn, appSettings.emotes);
applyMenuLanguage();

if (sortToggleBtn) {
    sortToggleBtn.addEventListener('click', () => {
        appSettings.sortCards = !appSettings.sortCards;
        renderSwitchState(sortToggleBtn, appSettings.sortCards);
        saveAppSettings();
    });
}

if (emotesToggleBtn) {
    emotesToggleBtn.addEventListener('click', () => {
        appSettings.emotes = !appSettings.emotes;
        renderSwitchState(emotesToggleBtn, appSettings.emotes);
        saveAppSettings();
    });
}

document.querySelectorAll('#lang-seg .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        appSettings.lang = btn.getAttribute('data-lang') || 'ru';
        saveAppSettings();
        applyMenuLanguage();
    });
});

const socket = io({ transports: ['polling'] });

const MODE_VAL_TO_KEY = {
    podkidnoy: 'подкидной',
    sosedi: 'соседи',
    shulera: 'с шулерами',
    klassika: 'классика',
    perevodnoy: 'переводной',
    vse: 'все',
    chestnaya: 'честная',
    nichya: 'ничья'
};

function goToGame() {
    const players = document.querySelector('#players-seg .seg-btn.active').innerText;
    const deck = document.querySelector('#deck-seg .seg-btn.active').innerText;
    const speed = document.querySelector('#speed-seg .seg-btn.active').innerText;

    const activeModes = [];
    document.querySelectorAll('.mode-card.active').forEach(card => {
        const val = card.getAttribute('data-val');
        activeModes.push(MODE_VAL_TO_KEY[val] || card.querySelector('.mode-name').innerText);
    });

    const gameSettings = {
        players: parseInt(players),
        deck: parseInt(deck),
        speed: speed,
        modes: activeModes
    };

    localStorage.setItem('durak_current_game', JSON.stringify(gameSettings));
    socket.emit('create_game', userProfile, gameSettings, () => {
        window.location.replace('/game');
    });
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

function resizeImageToBase64(file, callback) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const size = 128;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

            callback(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

socket.on('update_players', function(players) {
    const container = document.querySelector('.friends-list');
    if (!container) return;

    container.innerHTML = '';

    players.forEach(player => {
        const isMe = userProfile && player.token === userProfile.token;
        const playerElement = document.createElement('div');
        playerElement.className = 'player-item';

        playerElement.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg);">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="avatar-wrap" style="width: 42px; height: 42px; box-shadow: 0 0 10px var(--emerald-glow); background: conic-gradient(from 0deg, var(--emerald), #27ae60, var(--emerald));">
                        <div class="avatar-placeholder" style="font-size: 16px; color: #fff; overflow: hidden;">
                            ${renderAvatarHtml(player.avatar, player.name, '18px')}
                        </div>
                        <div class="online-dot" style="bottom: -2px; right: -2px;"></div>
                    </div>
                    <div>
                        <div style="font-size: 14px; font-weight: 700;">
                            ${player.name} ${isMe ? `<span style="color:var(--amber); font-size:11px;">${tMenu('you_tag')}</span>` : ''}
                        </div>
                        <div style="font-size: 11px; color: var(--emerald); font-weight: 600;">${tMenu('online_status')}</div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(playerElement);
    });
});

socket.on('receive_invite', function(data) {
    showInviteModal(data.host_name, data.host_money, data.host_token, data.host_avatar);
});

const profileNameEl = document.querySelector('.profile-name');
const profileAvatarEl = document.querySelector('.avatar-placeholder');
const profileBlockEl = document.querySelector('.profile');

function applyProfileToHeader() {
    if (!userProfile || !profileNameEl || !profileAvatarEl) return;
    profileNameEl.textContent = userProfile.name;
    profileAvatarEl.style.overflow = 'hidden';
    profileAvatarEl.innerHTML = renderAvatarHtml(userProfile.avatar, userProfile.name, '20px');
}

applyProfileToHeader();

function updateMenuCoinsUI() {
    const goldEl = document.getElementById('gold-val');
    if (goldEl && userProfile) {
        goldEl.textContent = userProfile.gold ?? 5;
    }
}
updateMenuCoinsUI();

function claimZeroBonus() {
    if (!userProfile) return;
    if ((userProfile.gold ?? 0) > 0) {
        showToast(tMenu('toast_coins_info'));
        return;
    }
    userProfile.gold = 1;
    localStorage.setItem('durak_user_profile', JSON.stringify(userProfile));
    updateMenuCoinsUI();
    socket.emit('auth', userProfile);
    showToast(tMenu('toast_zero_bonus'));
}

if (profileBlockEl && userProfile) {
    const editOverlay = document.getElementById('profile-edit-overlay');
    const previewEl = document.getElementById('edit-avatar-preview');
    const nameInput = document.getElementById('edit-name-input');
    const fileInput = document.getElementById('avatar-file-input');
    const saveBtn = document.getElementById('profile-save-btn');
    const cancelBtn = document.getElementById('profile-cancel-btn');

    let tempAvatar = userProfile.avatar || 'default.png';

    function updatePreview() {
        const currentName = nameInput.value.trim() || userProfile.name;
        previewEl.innerHTML = renderAvatarHtml(tempAvatar, currentName, '30px');
    }

    profileBlockEl.style.cursor = 'pointer';
    profileBlockEl.onclick = () => {
        tempAvatar = userProfile.avatar || 'default.png';
        nameInput.value = userProfile.name;
        updatePreview();
        editOverlay.classList.add('show');
    };

    nameInput.addEventListener('input', updatePreview);

    document.querySelectorAll('.avatar-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            tempAvatar = btn.getAttribute('data-val');
            updatePreview();
        });
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        resizeImageToBase64(file, (base64Data) => {
            tempAvatar = base64Data;
            updatePreview();
        });
    });

    cancelBtn.onclick = () => editOverlay.classList.remove('show');

    saveBtn.onclick = () => {
        const cleanName = nameInput.value.trim().slice(0, 14);
        if (cleanName) userProfile.name = cleanName;
        userProfile.avatar = tempAvatar;

        localStorage.setItem('durak_user_profile', JSON.stringify(userProfile));
        applyProfileToHeader();
        socket.emit('auth', userProfile);
        editOverlay.classList.remove('show');
        showToast(tMenu('toast_profile_saved'));
    };
}
function sendMenuAuth() {
    if (!userProfile || typeof socket === 'undefined' || !socket || !socket.connected) return;
    socket.emit('leave_game', { token: userProfile.token });
    socket.emit('auth', userProfile);
}

socket.on('connect', sendMenuAuth);

window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        window.location.reload();
        return;
    }
    sendMenuAuth();
});

if (socket.connected) {
    sendMenuAuth();
}
