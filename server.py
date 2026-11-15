from flask import Flask, request, render_template
from flask_socketio import SocketIO, emit
from logic import *
from pathlib import Path
import json
import os
import time
import threading

db_lock = threading.RLock()

BASE_DIR = Path(__file__).resolve().parent

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / 'templates'),
    static_folder=str(BASE_DIR / 'static')
)

socketio = SocketIO(app, cors_allowed_origins="*")

# --- Твои настройки игры ---
suits_durak = ['♠', '♣', '♥', '♦']
ranks_durak = {
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

# Хранение соответствия: session_id -> id_игрока
players_map = {}
conn_sids = []

DATA_FILE = str(BASE_DIR / 'players_db.json')

active_games = {}
active_players = {}

def read_players_db():
    if not (os.path.exists(DATA_FILE) and os.path.getsize(DATA_FILE) > 0):
        return []
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as file:
            data = json.load(file)
            return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []

def json_append(data_f):
    with db_lock:
        data = read_players_db()
        data = [i for i in data if i.get("token") != data_f.get("token")]
        data.append(data_f)

        tmp_file = f"{DATA_FILE}.tmp"
        with open(tmp_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        os.replace(tmp_file, DATA_FILE)


def get_sid(token):
    with db_lock:
        for i in read_players_db():
            if i.get('token') == token:
                return i.get('sid')
    return None

def get_online_players():
    with db_lock:
        all_players = read_players_db()
    by_token = {p['token']: p for p in all_players if 'token' in p}

    result = []
    for tok in conn_sids:
        p = by_token.get(tok)
        if p:
            result.append({
                'token': tok,
                'name': p.get('name', f'Игрок {tok[:4]}'),
                'avatar': p.get('avatar', 'default.png')
            })
    return result

def update_action_buttons(room_id):
    game = active_games[room_id]['game']
    players_tokens = list(active_games[room_id]['players'].keys())
    def_token = players_tokens[game.defense_index]
    def_player = game.players[def_token]

    has_cards = len(game.table) > 0
    has_unbeaten = game.check_bery()

    # Кнопка "Взять" — только у отбивающегося, пока есть непобитые карты и он ещё не нажал "Взять"
    for tok in players_tokens:
        sid = active_players[tok]['sid']
        can_take = has_cards and has_unbeaten and (tok == def_token) and not def_player.bery
        socketio.emit('bery_off_on', can_take, to=sid)

    # Кнопка "Бито" (когда всё побито) или "Пас" (когда отбивающийся уже нажал "Взять")
    eligible_throwers = set(game.get_eligible_throwers())
    btn_label = 'Пас' if def_player.bery else 'Бито'
    can_end_condition = (not has_unbeaten) or def_player.bery

    for tok in players_tokens:
        sid = active_players[tok]['sid']
        can_press_done = (
            has_cards
            and can_end_condition
            and tok in eligible_throwers
            and tok not in game.passed_tokens
            and len(game.players[tok].my_cards) > 0
        )
        socketio.emit('bito_off_on', {'show': can_press_done, 'text': btn_label}, to=sid)

def spend_player_coins(room_id, token, amount):
    coins = active_games[room_id]['coins']
    if coins.get(token, 0) < amount:
        return False
    coins[token] -= amount
    if token in active_players and 'prof' in active_players[token]:
        active_players[token]['prof']['gold'] = coins[token]
        json_append(active_players[token]['prof'])
    socketio.emit('coins_updated', {'coins': coins[token]}, to=active_players[token]['sid'])
    return True

def join_room():
    pass

@socketio.on('auth')
def handle_connect(data):
    token = data["token"]
    data['sid'] = request.sid
    with db_lock:
        json_append(data)
        if token not in active_players:
            active_players[token] = {}
        active_players[token]['sid'] = request.sid
        active_players[token]['prof'] = data

        if token not in conn_sids:
            conn_sids.append(token)
    emit('update_players', get_online_players(), broadcast=True)

# @socketio.on('connect')
# def handle_connect():
#     # 1. Добавляем текущего игрока в список, если его там нет
#     print(request.sid, conn_sids)
#     if request.sid not in conn_sids:
#         conn_sids.append(request.sid)
    
#     # 2. Формируем список имен
#     current_players = []
#     for sid in conn_sids:
#         current_players.append({'name': f'Игрок {sid[:4]}'})

#     emit('update_players', current_players, broadcast=True)
    
@socketio.on('disconnect')
def handle_disconnect():
    disconnected_sid = request.sid

    with db_lock:
        for tok, pdata in list(active_players.items()):
            if pdata.get('sid') == disconnected_sid:
                handle_player_exit(tok, reason='left')
                if active_players.get(tok, {}).get('sid') == disconnected_sid and tok in conn_sids:
                    conn_sids.remove(tok)
                break

    emit('update_players', get_online_players(), broadcast=True)

@socketio.on('leave_game')
def handle_leave_game(data):
    token = data.get('token')
    if token:
        print(f"[SERVER] Игрок {token[:6]} вышел из игры")
        handle_player_exit(token, reason='left')


@socketio.on('surrender_game')
def handle_surrender_game(data):
    token = data.get('token')
    if token:
        print(f"[SERVER] Игрок {token[:6]} сдался")
        handle_player_exit(token, reason='surrender')

@socketio.on('frends_l')
def fr():
    emit('frend_res', get_online_players())

def get_ranks_by_deck(deck_size):
    all_ranks = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
        'J': 11, 'Q': 12, 'K': 13, 'A': 14
    }
    if deck_size == 24:
        return {k: v for k, v in all_ranks.items() if v >= 9}
    if deck_size == 52:
        return all_ranks
    return {k: v for k, v in all_ranks.items() if v >= 6}


@socketio.on('create_game')
def handle_create(data, gamesat):
    token = data['token']
    room_id = f"room_{token}"

    modes = [m.lower() for m in gamesat.get('modes', [])]
    is_transferable = 'переводной' in modes
    allow_cheating = 'с шулерами' in modes
    throw_all = 'все' in modes
    allow_draw = 'ничья' in modes

    active_players[token] = {}
    active_players[token]['room_id'] = room_id
    active_games[room_id] = {}
    active_games[room_id]['game'] = Game(
        get_ranks_by_deck(gamesat.get('deck', 36)),
        suits_durak,
        gamesat['players'],
        is_transferable=is_transferable,
        allow_cheating=allow_cheating,
        throw_all=throw_all,
        allow_draw=allow_draw
    )
    is_fast = gamesat.get('speed') == '▶▶'
    active_games[room_id]['turn_duration'] = 12 if is_fast else 30
    active_games[room_id]['timer_gen'] = 0
    active_games[room_id]['game_satting'] = gamesat
    active_games[room_id]['players'] = {}
    active_games[room_id]['coins'] = {}
    return True

@socketio.on('player_ready_in_game')
def handler_init_game(data):
    print("Данные подключения игрока:", data)
    token = data['token']
    sid = request.sid

    # === УМНАЯ ПРОВЕРКА КОМНАТЫ ===
    # 1. Если сервер УЖЕ помнит этого игрока (Создатель после handle_create или реконнект)
    print(active_players)
    if token in active_players and 'room_id' in active_players[token]:
        room_id = active_players[token]['room_id']
    else:
        # 2. Если сервера видит игрока впервые (Гость зашел по приглашению)
        host_token = data.get('host_token')
        print(host_token)
        if not host_token:
            print(f"Критическая ошибка: неизвестный игрок {token[:5]} без хоста!")
            return
        room_id = host_token
    # ==============================

    # Страховка
    if room_id not in active_games:
        print(f"Ошибка: Комната {room_id} не найдена на сервере!")
        return
    # Отправляем настройки обратно зашедшему игроку
    gameset = active_games[room_id]['game_satting']
    emit('init_game_data', gameset, to=sid)

    # Защита от дубликатов в списках
    if token not in active_games[room_id]['players']:
        active_games[room_id]['game'].players[token] = Player()
        active_games[room_id]['players'][token] = False
    
    # Сохраняем/обновляем анкету игрока
    active_players[token] = {}
    active_players[token]['room_id'] = room_id
    active_players[token]['prof'] = data['prof']
    active_players[token]['sid'] = sid 

    # Твой крутой алгоритм ротации списков соперников
    lst = list(active_games[room_id]['players'].keys())
    for i, tok in enumerate(lst):
        res = lst[i:] + lst[:i]
        opponents_profiles = [active_players[j]['prof'] for j in res[1:]]
        target_sid = active_players[tok]['sid']
        emit('frend_connect', opponents_profiles, to=target_sid)

@socketio.on('player_ready_to_start')
def hendler_ready_to_start(data):
    room_id = active_players[data['token']]['room_id']
    active_games[room_id]['players'][data['token']] = True
    
    if all(active_games[room_id]['players'].values()):
        game = active_games[room_id]['game']
        game.prepare_game()
        for i in active_games[room_id]['players'].keys():
            player_coins = active_players[i]['prof'].get('gold', 5)
            active_games[room_id]['coins'][i] = player_coins
            sid = active_players[i]['sid']
            emit('game_started', {
                "your_cards": [c.get_card() for c in game.players[i].my_cards],
                "trump_card": game.trump_card.get_card(),
                "deck_count": len(game.deck),
                "turn_token": list(game.players.keys())[game.turn_index],
                "defender_token": list(game.players.keys())[game.defense_index],
                "allow_cheating": game.allow_ch,
                "coins": player_coins
            }, to=sid)
        reset_turn_timer(room_id)

def broadcast_turn_finished(room_id, reason):
    game = active_games[room_id]['game']
    players_tokens = list(active_games[room_id]['players'].keys())
    turn_token = list(game.players.keys())[game.turn_index]
    cards_counts = {tok: len(game.players[tok].my_cards) for tok in players_tokens}
    winners = game.check_winner()

    if winners and not game.is_draw:
        for w_tok in winners:
            if w_tok in active_players and 'prof' in active_players[w_tok]:
                prof = active_players[w_tok]['prof']
                prof['gold'] = prof.get('gold', 5) + 1
                json_append(prof)

    for tok in players_tokens:
        sid = active_players[tok]['sid']
        current_gold = active_players[tok]['prof'].get('gold', 5)
        socketio.emit('turn_finished', {
            'your_cards': [c.get_card() for c in game.players[tok].my_cards],
            'deck_count': len(game.deck),
            'turn_token': turn_token,
            'defender_token': list(game.players.keys())[game.defense_index],
            'players_cards_count': cards_counts,
            'reason': reason,
            'winners': winners,
            'is_draw': game.is_draw,
            'your_coins': current_gold
        }, to=sid)
    if winners:
        cleanup_finished_room(room_id)

def cleanup_finished_room(room_id):
    if room_id not in active_games:
        return
    room = active_games[room_id]
    room['timer_gen'] = room.get('timer_gen', 0) + 1
    for tok in list(room['players'].keys()):
        if tok in active_players:
            active_players[tok].pop('room_id', None)
    active_games.pop(room_id, None)


def handle_player_exit(token, reason='left'):
    if token not in active_players or 'room_id' not in active_players[token]:
        return
    room_id = active_players[token]['room_id']
    active_players[token].pop('room_id', None)

    if room_id not in active_games:
        return

    room = active_games[room_id]
    game = room['game']
    players_tokens = list(room['players'].keys())

    if token not in players_tokens:
        return

    leaver_name = active_players[token].get('prof', {}).get('name', 'Игрок')

    # 1. ИГРА ЕЩЁ НЕ НАЧАЛАСЬ (игроки ждут в лобби)
    if game.turn_index is None:
        # Если вышел создатель комнаты — закрываем комнату для всех гостей
        if room_id == f"room_{token}":
            for tok in players_tokens:
                if tok != token and tok in active_players:
                    active_players[tok].pop('room_id', None)
                    socketio.emit('room_closed', {'message': 'Хост закрыл комнату'}, to=active_players[tok]['sid'])
            active_games.pop(room_id, None)
        else:
            # Если вышел гость — освобождаем его слот и обновляем список ожидания у остальных
            room['players'].pop(token, None)
            game.players.pop(token, None)
            lst = list(room['players'].keys())
            for i, tok in enumerate(lst):
                res = lst[i:] + lst[:i]
                opponents_profiles = [active_players[j]['prof'] for j in res[1:]]
                socketio.emit('frend_connect', opponents_profiles, to=active_players[tok]['sid'])
        return

    # 2. ИГРА УЖЕ ЗАКОНЧИЛАСЬ
    if game.winners:
        room['players'].pop(token, None)
        if not room['players']:
            cleanup_finished_room(room_id)
        return

    # 3. ИГРА ИДЁТ ПРЯМО СЕЙЧАС — засчитываем поражение вышедшему/сдавшемуся и победу оставшимся
    winners = [tok for tok in players_tokens if tok != token]
    game.winners = winners
    game.is_draw = False

    for w_tok in winners:
        if w_tok in active_players and 'prof' in active_players[w_tok]:
            prof = active_players[w_tok]['prof']
            prof['gold'] = prof.get('gold', 5) + 1
            json_append(prof)

    cards_counts = {tok: len(game.players[tok].my_cards) for tok in players_tokens}

    for tok in players_tokens:
        if tok not in active_players:
            continue
        # Если игрок нажал "Назад" и ушёл со страницы игры, ему итог шлём только при сдаче
        if tok == token and reason != 'surrender':
            continue
        sid = active_players[tok]['sid']
        socketio.emit('timer_update', {'active': False}, to=sid)
        socketio.emit('turn_finished', {
            'your_cards': [c.get_card() for c in game.players[tok].my_cards],
            'deck_count': len(game.deck),
            'turn_token': token,
            'defender_token': token,
            'players_cards_count': cards_counts,
            'reason': reason,
            'leaver_name': leaver_name,
            'winners': winners,
            'is_draw': False,
            'your_coins': active_players[tok]['prof'].get('gold', 5)
        }, to=sid)

    cleanup_finished_room(room_id)

def reset_turn_timer(room_id):
    if room_id not in active_games:
        return
    room = active_games[room_id]
    game = room['game']
    players_tokens = list(room['players'].keys())

    # Увеличиваем поколение, чтобы предыдущий запущенный таймер сам отменился
    room['timer_gen'] = room.get('timer_gen', 0) + 1
    gen = room['timer_gen']

    if game.winners:
        for tok in players_tokens:
            socketio.emit('timer_update', {'active': False}, to=active_players[tok]['sid'])
        return

    base_dur = room.get('turn_duration', 30)
    att_token = players_tokens[game.turn_index]
    def_token = players_tokens[game.defense_index]
    def_player = game.players[def_token]

    if len(game.table) == 0:
        duration = base_dur
        target_token = att_token
        phase = 'attack'
    elif game.check_bery() and not def_player.bery:
        duration = base_dur
        target_token = def_token
        phase = 'defend'
    else:
        duration = max(7, base_dur // 2)
        target_token = 'throwers'
        phase = 'finish_turn'

    for tok in players_tokens:
        socketio.emit('timer_update', {
            'active': True,
            'seconds': duration,
            'target_token': target_token,
            'phase': phase
        }, to=active_players[tok]['sid'])

    socketio.start_background_task(turn_timer_worker, room_id, gen, duration)


def turn_timer_worker(room_id, gen, duration):
    socketio.sleep(duration)
    if room_id not in active_games:
        return
    room = active_games[room_id]
    if room.get('timer_gen') != gen:
        return  # Игрок успел походить до истечения времени

    game = room['game']
    if game.winners:
        return

    players_tokens = list(room['players'].keys())
    att_token = players_tokens[game.turn_index]
    def_token = players_tokens[game.defense_index]
    att_player = game.players[att_token]
    def_player = game.players[def_token]

    # 1. Истекло время первого хода атакующего -> ходим младшей не козырной картой
    if len(game.table) == 0:
        if att_player.my_cards:
            lowest_card = min(
                att_player.my_cards,
                key=lambda c: (c.suit == game.trump_suit, game.ranks[c.rank])
            )
            card_arr = list(lowest_card.get_card())
            if game.process_move(att_player, card_arr):
                update_action_buttons(room_id)
                for tok in players_tokens:
                    socketio.emit('table_updated', {
                        'table_pairs': [{'atk': card_arr, 'def': None}],
                        'attacker_token': att_token,
                        'cards_left_in_hand': len(att_player.my_cards)
                    }, to=active_players[tok]['sid'])
                socketio.emit('cards_updated', [c.get_card() for c in att_player.my_cards], to=active_players[att_token]['sid'])
                reset_turn_timer(room_id)
        return

    # 2. Истекло время защиты -> автоматическое "Взять"
    if game.check_bery() and not def_player.bery:
        def_player.bery = True
        game.passed_tokens.clear()
        active_throwers = {
            tok for tok in game.get_eligible_throwers()
            if len(game.players[tok].my_cards) > 0
        }
        if not active_throwers:
            game.finish_turn(ber=True)
            broadcast_turn_finished(room_id, 'take')
            reset_turn_timer(room_id)
        else:
            update_action_buttons(room_id)
            def_name = active_players[def_token]['prof'].get('name', 'Соперник')
            for tok in players_tokens:
                socketio.emit('defender_taking', {
                    'defender_token': def_token,
                    'defender_name': def_name
                }, to=active_players[tok]['sid'])
            reset_turn_timer(room_id)
        return

    # 3. Истекло время на подкидывание / "Бито" / "Пас" -> завершаем кон
    is_taking = def_player.bery
    game.finish_turn(ber=is_taking)
    broadcast_turn_finished(room_id, 'take' if is_taking else 'bito')
    reset_turn_timer(room_id)

def sync_table_after_rollback(room_id):
    game = active_games[room_id]['game']
    players_tokens = list(active_games[room_id]['players'].keys())
    att_token = list(game.players.keys())[game.turn_index]
    def_token = list(game.players.keys())[game.defense_index]

    table_pairs = [
        {
            'atk': pair[0].get_card(),
            'def': pair[1].get_card() if pair[1] is not None else None
        }
        for pair in game.table
    ]
    cards_counts = {tok: len(game.players[tok].my_cards) for tok in players_tokens}

    # Обновляем доступность кнопок "Взять" и "Бито"
    has_unbeaten = game.check_bery()
    has_cards = len(game.table) > 0
    update_action_buttons(room_id)

    for tok in players_tokens:
        sid = active_players[tok]['sid']
        emit('table_synced', {
            'table_pairs': table_pairs,
            'your_cards': [c.get_card() for c in game.players[tok].my_cards],
            'players_cards_count': cards_counts,
            'caught_cheaters': list(game.caught_cheaters)
        }, to=sid)
    reset_turn_timer(room_id)


@socketio.on('report_cheat_card')
def handler_report_cheat_card(data):
    token = data['token']
    room_id = active_players[token]['room_id']
    game = active_games[room_id]['game']
    players_tokens = list(active_games[room_id]['players'].keys())

    res = game.report_card(token, data['pair_index'], data['role'])
    if res['status'] in ('caught', 'false_accusation'):
        cheater_tok = res['cheater_token']
        cheater_name = active_players[cheater_tok]['prof'].get('name', 'Игрок')
        sync_table_after_rollback(room_id)
        for tok in players_tokens:
            emit('cheat_exposed', {
                'status': res['status'],
                'cheater_token': cheater_tok,
                'cheater_name': cheater_name,
                'caught_cheaters': list(game.caught_cheaters)
            }, to=active_players[tok]['sid'])


@socketio.on('undo_move')
def handler_undo_move(data):
    token = data['token']
    room_id = active_players[token]['room_id']
    game = active_games[room_id]['game']

    # Сначала проверяем баланс, а списываем монету только если карту реально удалось вернуть
    if active_games[room_id]['coins'].get(token, 0) < 1:
        return
    if game.undo_last_action(token):
        spend_player_coins(room_id, token, 1)
        sync_table_after_rollback(room_id)


@socketio.on('get_discard_pile')
def handler_get_discard_pile(data):
    token = data['token']
    room_id = active_players[token]['room_id']
    game = active_games[room_id]['game']

    if not spend_player_coins(room_id, token, 3):
        return
    sid = active_players[token]['sid']
    emit('discard_pile_data', {
        'cards': [c.get_card() for c in game.discard_pilev]
    }, to=sid)


@socketio.on('buy_highlight')
def handler_buy_highlight(data):
    token = data['token']
    room_id = active_players[token]['room_id']

    if not spend_player_coins(room_id, token, 2):
        return
    emit('highlight_enabled', True, to=active_players[token]['sid'])

def get_active_match(token):
    if not token or token not in active_players:
        return None, None, None
    room_id = active_players[token].get('room_id')
    if not room_id or room_id not in active_games:
        return None, None, None
    game = active_games[room_id]['game']
    if token not in game.players:
        return None, None, None
    return room_id, game, game.players[token]

@socketio.on('send_emote')
def handler_send_emote(data):
    token = data.get('token')
    emoji = str(data.get('emoji', '')).strip()
    if not emoji or len(emoji) > 8:
        return

    room_id, game, _ = get_active_match(token)
    if not game:
        return

    for tok in active_games[room_id]['players'].keys():
        if tok != token and tok in active_players:
            emit('receive_emote', {
                'sender_token': token,
                'emoji': emoji
            }, to=active_players[tok]['sid'])

@socketio.on('bito_move')
def handler_bito_move(data):
    token = data.get('token')
    room_id, game, _ = get_active_match(token)
    if not game:
        return
    def_player = game.def_players()

    if token not in game.get_eligible_throwers():
        return
    if len(game.table) == 0:
        return
    # Нажать можно только если все карты побиты ИЛИ защищающийся уже нажал "Взять"
    if game.check_bery() and not def_player.bery:
        return

    game.passed_tokens.add(token)

    active_throwers = {
        tok for tok in game.get_eligible_throwers()
        if len(game.players[tok].my_cards) > 0
    }

    if active_throwers.issubset(game.passed_tokens):
        is_taking = def_player.bery
        game.finish_turn(ber=is_taking)
        broadcast_turn_finished(room_id, 'take' if is_taking else 'bito')
        reset_turn_timer(room_id)
    else:
        update_action_buttons(room_id)
        player_name = active_players[token]['prof'].get('name', 'Игрок')
        action_word = 'Пас' if def_player.bery else 'Бито'
        for tok in active_games[room_id]['players'].keys():
            if tok != token:
                emit('player_passed_bito', {'name': player_name, 'action': action_word}, to=active_players[tok]['sid'])

@socketio.on('take_move')
def handler_take_move(data):
    token = data.get('token')
    room_id, game, player = get_active_match(token)
    if not game:
        return

    # Взять может только защищающийся, пока на столе есть непобитые карты и он ещё не нажал "Взять"
    if game.check_player_defend(player) and game.check_bery() and not player.bery:
        player.bery = True
        game.passed_tokens.clear()

        # Страховка: если у подкидывающих вообще не осталось карт на руках — забираем сразу
        active_throwers = {
            tok for tok in game.get_eligible_throwers()
            if len(game.players[tok].my_cards) > 0
        }
        if not active_throwers:
            game.finish_turn(ber=True)
            broadcast_turn_finished(room_id, 'take')
            reset_turn_timer(room_id)
            return

        update_action_buttons(room_id)
        def_name = active_players[token]['prof'].get('name', 'Соперник')
        for tok in active_games[room_id]['players'].keys():
            emit('defender_taking', {
                'defender_token': token,
                'defender_name': def_name
            }, to=active_players[tok]['sid'])
        reset_turn_timer(room_id)

@socketio.on('invite_room')
def handler_invite(data):
    room_id = f"room_{data['from_token']}"
    token = data['to_token']
    sid = get_sid(token)
    if sid:
        emit('receive_invite', {
            'host_name': data['from_name'],
            'host_token': room_id,
            'host_money': data.get('from_money', '36 карт'),
            'host_avatar': data.get('from_avatar', 'default.png')
        }, to=sid)

@socketio.on('attack_move')
def handler_atc_move(card):
    room_id, game, player = get_active_match(card.get('token'))
    if not game:
        return
    players = list(active_games[room_id]['players'].keys())
    defing_pl_sid = active_players[list(game.players.keys())[(game.turn_index + 1) % len(game.players)]]['sid']

    if game.check_player_move(player):
        if game.process_move(player, card['card']):
            if game.check_bery():
                update_action_buttons(room_id)
            for i in players:
                sid = active_players[i]['sid']
                emit('table_updated', {
                    'table_pairs': [{'atk': card['card'], 'def': None}],
                    'attacker_token': card['token'],
                    'cards_left_in_hand': len(player.my_cards)
                }, to=sid)

            if game.def_players().bery:
                active_throwers = {
                    tok for tok in game.get_eligible_throwers()
                    if len(game.players[tok].my_cards) > 0
                }
                if active_throwers.issubset(game.passed_tokens):
                    game.finish_turn(ber=True)
                    broadcast_turn_finished(room_id, 'take')
            reset_turn_timer(room_id)
        emit('cards_updated', [i.get_card() for i in player.my_cards])

    elif game.is_tr and game.check_player_defend(player):
        if game.process_transfer(player, card['card']):
            old_def_sid = active_players[card['token']]['sid']
            new_def_token = list(game.players.keys())[game.defense_index]
            new_def_sid = active_players[new_def_token]['sid']
            from_name = active_players[card['token']]['prof'].get('name', 'Соперник')

            # Переключаем кнопку "Взять" со старого защищающегося на нового
            emit('bery_off_on', False, to=old_def_sid)
            emit('bery_off_on', True, to=new_def_sid)
            emit('bito_off_on', False, to=old_def_sid)

            for i in players:
                sid = active_players[i]['sid']
                emit('table_updated', {
                    'table_pairs': [{'atk': card['card'], 'def': None}],
                    'attacker_token': card['token'],
                    'cards_left_in_hand': len(player.my_cards)
                }, to=sid)
                emit('turn_transferred', {
                    'new_attacker_token': card['token'],
                    'new_defender_token': new_def_token,
                    'from_name': from_name
                }, to=sid)
            reset_turn_timer(room_id)
        emit('cards_updated', [i.get_card() for i in player.my_cards])

@socketio.on('defend_move')
def handler_def_move(card):
    room_id, game, player = get_active_match(card.get('token'))
    if not game:
        return
    players = list(active_games[room_id]['players'].keys())
    if game.check_player_defend(player):
        if game.process_move(player, card['card'], card['covered_card']):
            if not game.check_bery():
                update_action_buttons(room_id)
            for i in players:
                sid = active_players[i]['sid']
                emit('table_updated', {
                'table_pairs': [{'atk': card['covered_card'], 'def': card['card']}],
                'attacker_token': card['token'],
                'cards_left_in_hand': len(player.my_cards)
            }, to=sid)
            reset_turn_timer(room_id)
        emit('cards_updated', [i.get_card() for i in player.my_cards])

@app.route('/')
def index():
    # Flask будет искать этот файл в папке templates
    return render_template('menu.html')

@app.route('/game')
def game_page():
    return render_template('game.html')

# def get_player_id():
#     return players_map.get(request.sid)

# def sync_game_state():
#     """Рассылает всем актуальные карты и состояние стола"""
#     for sid, p_id in players_map.items():
#         # Отправляем каждому его карты
#         socketio.emit('update_hand', game.players[p_id].my_cards, to=sid)
    
#     # Отправляем всем состояние стола
#     socketio.emit('update_table', game.table)
    
#     # Сообщаем, чей сейчас ход
#     socketio.emit('turn_info', {
#         'turn_index': game.turn_index,
#         'defense_index': game.defense_index
#     })

# @socketio.on('connect')
# def handle_connect():
#     if len(conn_sids) < game.pl_count:
#         p_id = len(conn_sids)
#         players_map[request.sid] = p_id
#         conn_sids.append(request.sid)
#         game.players.append(Player())
#         print(f"Игрок {p_id} подключился (SID: {request.sid})")

#         if len(conn_sids) == game.pl_count:
#             start_game()
#     else:
#         return False  # Отклонить лишние подключения

# def start_game():
#     game.prepare_game()
#     # Устанавливаем начальные индексы (твоя логика из hendler)
#     game.defense_index = (game.turn_index + 1) % game.pl_count
#     game.players[game.defense_index].defense = True
#     game.players[game.turn_index].move = True
    
#     print("Игра началась!")
#     sync_game_state()
#     socketio.emit('system_msg', 'Игра началась!')

# @socketio.on('player_action')
# def handle_action(msg):
#     id_pl = get_player_id()
#     if id_pl is None: return

#     next_idx = (game.turn_index + 1) % game.pl_count
#     res_msg = str(msg).lower().strip()

#     # --- Твоя проверка очереди хода ---
#     if not game.players[id_pl].move and not (id_pl == game.defense_index):
#         emit('system_msg', 'НЕ ваш ход')
#         return

#     # --- ЛОГИКА АТАКИ (move == True) ---
#     if game.players[id_pl].move:
#         if res_msg == 'бито':
#             if all(None not in i for i in game.table):
#                 game.finish_turn()
#                 # Проверка победителя (твоя логика)
#                 winners = game.check_winner()
#                 if winners: socketio.emit('system_msg', f'Победители: {winners}')
                
#                 game.turn_index = next_idx
#                 game.defense_index = (game.turn_index + 1) % game.pl_count
#                 game.players[game.defense_index].defense = True
#                 game.players[game.turn_index].move = True
#                 socketio.emit('system_msg', 'БИТО. Смена хода.')
#             elif game.players[game.defense_index].bery:
#                 game.finish_turn(True)
#                 game.turn_index = (game.defense_index + 1) % game.pl_count
#                 game.defense_index = (game.turn_index + 1) % game.pl_count
#                 game.players[game.defense_index].defense = True
#                 game.players[game.turn_index].move = True
#                 socketio.emit('system_msg', 'Игрок взял карты. Смена хода.')
#             else:
#                 emit('system_msg', 'Бито нажать нельзя')
#                 return
#         else:
#             # Попытка хода цифрой
#             if res_msg.isdigit():
#                 if game.process_move(game.players[id_pl], int(res_msg)):
#                     sync_game_state()
#                 else:
#                     emit('system_msg', 'Ход не выполнен')
#             else:
#                 emit('system_msg', 'Вы ввели мусор')

#     # --- ЛОГИКА ЗАЩИТЫ (id_pl == defense_index) ---
#     elif id_pl == game.defense_index:
#         if res_msg == 'взять':
#             if not all(None not in i for i in game.table):
#                 game.players[id_pl].bery = True
#                 emit('system_msg', 'Вы решили взять карты')
#             else:
#                 emit('system_msg', 'Взять нельзя')
#         elif ' ' in res_msg:
#             try:
#                 c1, c2 = map(int, res_msg.split())
#                 if game.process_move(game.players[id_pl], c1, c2):
#                     sync_game_state()
#                 else:
#                     emit('system_msg', 'Нельзя побить')
#             except:
#                 emit('system_msg', 'Ошибка ввода')
#         else:
#             emit('system_msg', 'Введите: [номер карты в руке] [номер карты на столе]')

#     sync_game_state()

if __name__ == '__main__':
    # host='0.0.0.0' позволит подключаться по локальной сети
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)