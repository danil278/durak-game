from itertools import product
from random import shuffle, randint, choice
class Card:
    def __init__(self, rank, suit):
        self.rank = rank
        self.suit = suit

    def get_card(self):
        return self.rank, self.suit
    
    def __repr__(self):
        return f"{self.rank}{self.suit}"

class Deck:
    def __init__(self, ranks, suits):
        self.cards = []
        for i, j in product(ranks, suits):
            self.cards.append(Card(i, j))
    
    def shuffle(self):
        shuffle(self.cards)

    def get_cards(self):
        return [i.get_card() for i in self.cards]
    
    def draw_card(self):
        return self.cards.pop() if self.cards else None

    def __len__(self):
        return len(self.cards)
    
class Player:
    def __init__(self, name='1'):
        self.my_cards = []
        self.name = name
        self.move = False
        self.defense = False
        self.bery = False
    
    def append_card(self, card):
        self.my_cards.append(card)

class Game:
    def __init__(self, ranks, suits, pl_count, is_transferable=False, is_podkidnoy=False, allow_cheating=False, limit_cards_per_attack=6, throw_all=False, allow_draw=False):
        self.deck = Deck(ranks.keys(), suits)
        self.ranks = ranks
        self.pl_count = pl_count
        self.players = {}
        self.trump_card = None
        self.trump_suit = None
        self.table = []
        self.discard_pilev = []
        self.turn_index = None
        self.defense_index = None
        self.is_tr = is_transferable
        self.is_pod = is_podkidnoy
        self.allow_ch = allow_cheating
        self.lcpa = limit_cards_per_attack
        self.throw_all = throw_all
        self.allow_draw = allow_draw
        self.turn_actions = []
        self.caught_cheaters = set()
        self.passed_tokens = set()
        self.winners = []
        self.is_draw = False

    def prepare_game(self):
        self.deck.shuffle()
        last_card = None
        for i in list(self.players.values()) * 6:
            last_card = self.deck.draw_card()
            i.append_card(last_card)
        self.trump_card = self.deck.cards[0] if self.deck.cards else last_card
        self.trump_suit = self.trump_card.suit
        self.check_first_move()

    def _is_player_active(self, token):
        return len(self.deck) > 0 or len(self.players[token].my_cards) > 0

    def _next_active_index(self, start_idx):
        tokens = list(self.players.keys())
        n = len(tokens)
        idx = start_idx
        for _ in range(n):
            idx = (idx + 1) % n
            if self._is_player_active(tokens[idx]):
                return idx
        return idx

    def check_first_move(self):
        res = None
        min_trump = None
        players_list = list(self.players.values())
        for i in players_list:
            p = filter(lambda j: j.suit == self.trump_suit, i.my_cards)
            try:
                now_min_trump = min(p, key=lambda m: self.ranks[m.rank])
                if min_trump is None or self.ranks[now_min_trump.rank] < self.ranks[min_trump.rank]:
                    min_trump = now_min_trump
                    res = i
            except ValueError:
                pass
        if res is None:
            res = choice(players_list)
        self.turn_index = players_list.index(res)
        self.defense_index = (self.turn_index + 1) % len(players_list)
        res.move = True
        players_list[self.defense_index].defense = True

    def get_eligible_throwers(self):
        """Возвращает список токенов игроков, которые имеют право подкидывать в этом кону"""
        tokens_list = list(self.players.keys())
        n = len(tokens_list)
        if n == 0:
            return []

        # Пока стол пустой, ходить может только основной атакующий
        if len(self.table) == 0:
            return [tokens_list[self.turn_index]]

        def_tok = tokens_list[self.defense_index]
        if self.throw_all:
            # Режим "Все": подкидывают все активные игроки, кроме отбивающегося
            return [tok for tok in tokens_list if tok != def_tok and self._is_player_active(tok)]
        else:
            # Режим "Соседи": только основной атакующий и следующий активный сосед отбивающегося
            allowed = {tokens_list[self.turn_index]}
            if n > 2:
                allowed.add(tokens_list[self._next_active_index(self.defense_index)])
            return [tok for tok in tokens_list if tok in allowed and tok != def_tok and self._is_player_active(tok)]

    def check_player_move(self, player):
        tok = self._get_player_token(player)
        return tok in self.get_eligible_throwers()
    
    def check_player_defend(self, player):
        return list(self.players.values())[(self.turn_index + 1) % len(self.players)] == player
    def def_players(self):
        return list(self.players.values())[(self.turn_index + 1) % len(self.players)]
    def check_bery(self):
        for i in self.table:
            if i[1] is None:
                return True
        return False

    def _get_player_token(self, player):
        for tok, pl in self.players.items():
            if pl == player:
                return tok
        return None

    def process_move(self, player, card: int, target_card: int = None):
        token = self._get_player_token(player)
        can_cheat = self.allow_ch and (token not in self.caught_cheaters)

        if not isinstance(card, int):
            card = [[i.rank, i.suit] for i in player.my_cards].index(card) + 1

        if not isinstance(target_card, int) and target_card is not None:
            table_atk_cards = [[pair[0].rank, pair[0].suit] for pair in self.table]
            target_card = table_atk_cards.index(target_card) + 1

        # --- АТАКА / ПОДКИДЫВАНИЕ ---
        if target_card is None:
            defense_player = self.def_players()
            unbeaten_count = sum(1 for pair in self.table if pair[1] is None)
            if len(self.table) >= self.lcpa or unbeaten_count >= len(defense_player.my_cards):
                return False

            if len(self.table) == 0:
                is_legal = True
            else:
                is_legal = player.my_cards[card - 1].rank in [i.rank for i in self.table_cards()]

            if not is_legal and not can_cheat:
                return False

            chosen_card = player.my_cards.pop(card - 1)
            self.table.append([chosen_card, None])
            self.turn_actions.append({
                'token': token,
                'role': 'atk',
                'card': chosen_card,
                'pair_index': len(self.table) - 1,
                'is_legal': is_legal
            })
            self.passed_tokens.clear()
            return True

        # --- ЗАЩИТА ---
        else:
            if player.bery or self.table[target_card - 1][1] is not None:
                return False

            atk_card = self.table[target_card - 1][0]
            def_card = player.my_cards[card - 1]

            if atk_card.suit == self.trump_suit:
                is_legal = (def_card.suit == self.trump_suit and self.ranks[def_card.rank] > self.ranks[atk_card.rank])
            else:
                is_legal = (def_card.suit == self.trump_suit) or (
                    def_card.suit == atk_card.suit and self.ranks[def_card.rank] > self.ranks[atk_card.rank]
                )

            if not is_legal and not can_cheat:
                return False

            chosen_card = player.my_cards.pop(card - 1)
            self.table[target_card - 1][1] = chosen_card
            self.turn_actions.append({
                'token': token,
                'role': 'def',
                'card': chosen_card,
                'pair_index': target_card - 1,
                'is_legal': is_legal
            })
            return True

    def undo_last_action(self, token):
        """Бустер ❌: вернуть последнюю брошенную карту, если после неё никто не ходил"""
        if not self.turn_actions or self.turn_actions[-1]['token'] != token:
            return False
        act = self.turn_actions.pop()
        self.players[token].my_cards.append(act['card'])
        if act['role'] == 'def':
            self.table[act['pair_index']][1] = None
        else:
            self.table.pop(act['pair_index'])
        self.passed_tokens.clear()
        if len(self.table) == 0:
            self.def_players().bery = False
        return True

    def report_card(self, reporter_token, pair_index, role):
        """Проверка карты на шулерство по клику"""
        if not self.allow_ch:
            return {'status': 'disabled'}

        target_act = None
        target_idx = -1
        for idx, act in enumerate(self.turn_actions):
            if act['pair_index'] == pair_index and act['role'] == role:
                target_act = act
                target_idx = idx
                break

        if not target_act or target_act['token'] == reporter_token:
            return {'status': 'ignore'}

        # 1. Карта оказалась НЕЗАКОННОЙ — возвращаем её и все карты после неё в руки владельцам
        if not target_act['is_legal']:
            to_revert = self.turn_actions[target_idx:]
            for act in reversed(to_revert):
                self.players[act['token']].my_cards.append(act['card'])
                if act['role'] == 'def':
                    self.table[act['pair_index']][1] = None
                else:
                    self.table.pop(act['pair_index'])
            self.turn_actions = self.turn_actions[:target_idx]
            self.caught_cheaters.add(target_act['token'])
            return {
                'status': 'caught',
                'cheater_token': target_act['token']
            }

        # 2. Карта была ЧЕСТНОЙ — ложное обвинение само считается жульничеством
        self.caught_cheaters.add(reporter_token)
        self.passed_tokens.clear()
        if len(self.table) == 0:
            self.def_players().bery = False
        return {
            'status': 'false_accusation',
            'cheater_token': reporter_token
        }

    def process_transfer(self, player, card):
        if player.bery or not self.is_tr or not self.check_player_defend(player):
            return False
        if len(self.table) == 0 or len(self.table) >= self.lcpa:
            return False
        # Нельзя переводить, если хотя бы одна карта на столе уже побита
        if any(pair[1] is not None for pair in self.table):
            return False

        if not isinstance(card, int):
            try:
                card = [[i.rank, i.suit] for i in player.my_cards].index(card) + 1
            except ValueError:
                return False

        chosen_card = player.my_cards[card - 1]
        # Номинал карты должен совпадать с картами на столе
        if chosen_card.rank != self.table[0][0].rank:
            return False

        players_list = list(self.players.values())
        n = len(players_list)
        new_def_index = (self.turn_index + 2) % n
        new_defender = players_list[new_def_index]

        # У следующего игрока должно хватать карт, чтобы отбить все карты после перевода
        if len(new_defender.my_cards) < len(self.table) + 1:
            return False

        # Выполняем перевод: защищающийся становится атакующим, ход сдвигается по кругу
        player.my_cards.pop(card - 1)
        self.table.append([chosen_card, None])

        old_attacker = players_list[self.turn_index]
        old_attacker.move = False
        player.defense = False
        player.move = True

        self.turn_index = (self.turn_index + 1) % n
        self.defense_index = new_def_index
        new_defender.defense = True

        self.turn_actions.append({
            'token': self._get_player_token(player),
            'role': 'transfer',
            'card': chosen_card,
            'pair_index': len(self.table) - 1,
            'is_legal': True
        })

        # В undo_last_action после проверки токена:
        if self.turn_actions[-1]['role'] == 'transfer':
            return False

        self.passed_tokens.clear()
        return True

    def finish_turn(self, ber=False):
        tokens_list = list(self.players.keys())
        players_list = list(self.players.values())
        n = len(players_list)

        att_token = tokens_list[self.turn_index]
        def_token = tokens_list[self.defense_index]
        attack_player = players_list[self.turn_index]
        defense_player = players_list[self.defense_index]

        # 1. Сначала добирают атакующий и остальные игроки по кругу (кроме отбивающегося)
        for offset in range(n):
            idx = (self.turn_index + offset) % n
            if idx == self.defense_index:
                continue
            pl = players_list[idx]
            while len(self.deck) > 0 and len(pl.my_cards) < 6:
                pl.append_card(self.deck.draw_card())

        # 2. Карты со стола уходят защищающемуся или в отбой
        if ber:
            defense_player.my_cards.extend(self.table_cards())
        else:
            self.discard_pilev.extend(self.table_cards())

        # 3. В самом конце добирает отбивавшийся
        while len(self.deck) > 0 and len(defense_player.my_cards) < 6:
            defense_player.append_card(self.deck.draw_card())

        self.table = []
        self.turn_actions = []
        self.passed_tokens.clear()
        attack_player.move = False
        defense_player.bery = False
        defense_player.defense = False

        # Проверяем, кто ещё остался в игре с картами
        active_tokens = [tok for tok in tokens_list if self._is_player_active(tok)]

        if len(active_tokens) == 0:
            # Все оставшиеся игроки вышли одновременно в этом кону
            if self.allow_draw:
                self.is_draw = True
                self.winners = [tok for tok in tokens_list if tok != def_token] + [def_token]
            else:
                # В "Классике" ничья невозможна — атакующий вышел первым, отбивающийся проиграл
                self.is_draw = False
                self.winners = [tok for tok in tokens_list if tok != def_token]
            return

        if len(active_tokens) == 1:
            # Остался один игрок с картами — он проиграл, все остальные победили
            loser_tok = active_tokens[0]
            self.is_draw = False
            self.winners = [tok for tok in tokens_list if tok != loser_tok]
            return

        # Игра продолжается — передаём ход следующему активному игроку
        base_idx = self.defense_index if ber else self.turn_index
        self.turn_index = self._next_active_index(base_idx)
        self.defense_index = self._next_active_index(self.turn_index)
        players_list[self.turn_index].move = True
        players_list[self.defense_index].defense = True

    def check_winner(self):
        return self.winners
    
    def table_cards(self):
        res = []
        for i, j in self.table:
            if j is None:
                res.append(i)
            else:
                res.append(i)
                res.append(j)
        return res

    def start(self):
        self.prepare_game()
        pl_move_now = list(self.players.values()).index(self.check_first_move())
        print(self.trump_card)
        len_pl_list = len(list(self.players.values()))
        while True:
            print(f"Ход: {list(self.players.values())[pl_move_now].name}")
            print(f'Карты игрока: {list(self.players.values())[pl_move_now].my_cards}')
            input()
            pl_move_now += 1
            if pl_move_now >= len_pl_list:
                pl_move_now = 0