package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"text/template"

	"golang.org/x/crypto/bcrypt"
	"nhooyr.io/websocket"
)

type Player struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Color string `json:"color"`
}

type WSMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type Client struct {
	conn *websocket.Conn
	send chan WSMessage
}

type Hub struct {
	clients map[*Client]bool
	lock    sync.Mutex
	db      *sql.DB
}

func NewHub(db *sql.DB) *Hub {
	return &Hub{
		clients: make(map[*Client]bool),
		db:      db,
	}
}

func (h *Hub) AddClient(c *Client) {
	h.lock.Lock()
	h.clients[c] = true
	h.lock.Unlock()
	go c.writeLoop()
}

func (h *Hub) RemoveClient(c *Client) {
	h.lock.Lock()
	delete(h.clients, c)
	h.lock.Unlock()
	c.conn.Close(websocket.StatusNormalClosure, "")
}

func (h *Hub) Broadcast(msg WSMessage) {
	h.lock.Lock()
	defer h.lock.Unlock()
	for client := range h.clients {
		select {
		case client.send <- msg:
		default:
			close(client.send)
			delete(h.clients, client)
		}
	}
}

func (c *Client) writeLoop() {
	for msg := range c.send {
		data, err := json.Marshal(msg)
		if err != nil {
			log.Println("write error marshal:", err)
			continue
		}
		c.conn.Write(context.Background(), websocket.MessageText, data)
	}
}

func (h *Hub) WebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // safe for local dev
	})
	if err != nil {
		log.Println("WebSocket accept error:", err)
		return
	}

	defer conn.Close(websocket.StatusInternalError, "unexpected close")

	client := &Client{
		conn: conn,
		send: make(chan WSMessage, 16),
	}
	h.AddClient(client)
	defer h.RemoveClient(client)

	ctx := r.Context()
	for {
		_, msg, err := conn.Read(ctx)
		if err != nil {
			// Check if this is a normal closure or going away close, not an actual error
			closeErr := websocket.CloseStatus(err)
			if closeErr == websocket.StatusNormalClosure || closeErr == websocket.StatusGoingAway {
				log.Printf("WebSocket closed: %v", err)
			} else {
				log.Printf("WebSocket disconnected with error: %v", err)
			}
			break
		}

		var req WSMessage
		if err := json.Unmarshal(msg, &req); err != nil {
			log.Println("bad ws message:", err)
			continue
		}

		switch req.Type {
		case "move":
			m := req.Data.(map[string]interface{})
			id := int(m["id"].(float64))
			x := int(m["x"].(float64))
			y := int(m["y"].(float64))
			
			// Broadcast immediately without waiting for DB
			h.Broadcast(WSMessage{
				Type: "move",
				Data: map[string]interface{}{"id": id, "x": x, "y": y},
			})
			
			// Update DB asynchronously (non-blocking)
			go func() {
				_, err := h.db.Exec("UPDATE player SET x = $1, y = $2 WHERE id = $3", x, y, id)
				if err != nil {
					log.Println("async update error:", err)
				}
			}()
		case "create":
			data := req.Data.(map[string]interface{})
			name := data["name"].(string)
			accountID := int(data["accountId"].(float64))
			
			log.Printf("👤 Creating player: name='%s', accountId=%d", name, accountID)
			
			colors := []string{
				"teal", "tomato", "orange", "green", "gold", "pink",
				"cyan", "magenta", "lime", "coral", "brown", "orchid",
				"lightblue", "lightgreen", "khaki", "peachpuff", "lavender"}
			color := colors[rand.Intn(len(colors))]

			x := rand.Intn(800)
			y := rand.Intn(600)
			var id int
			
			err := h.db.QueryRow("INSERT INTO player (name, x, y, color) VALUES ($1, $2, $3, $4) RETURNING id", 
				name, x, y, color).Scan(&id)
			if err != nil {
				log.Printf("❌ Error creating player: %v", err)
				continue
			}
			
			log.Printf("✅ Player created successfully: id=%d, name='%s', position=(%d,%d)", id, name, x, y)
			
			// Update account's last_player_id
			_, err = h.db.Exec("UPDATE account SET last_player_id = $1 WHERE id = $2", id, accountID)
			if err != nil {
				log.Printf("❌ Error updating account last_player_id: %v", err)
			} else {
				log.Printf("✅ Updated account %d last_player_id to %d", accountID, id)
			}
			
			player := Player{ID: id, Name: name, X: x, Y: y, Color: color}
			client.send <- WSMessage{Type: "created", Data: player}
			h.Broadcast(WSMessage{Type: "new_player", Data: player})
			
			log.Printf("📤 Sent player creation messages for player %d", id)
		case "change_name":
			data := req.Data.(map[string]interface{})
			id := int(data["id"].(float64))
			name := data["name"].(string)
			_, _ = h.db.Exec("UPDATE player SET name = $1 WHERE id = $2", name, id)
			h.Broadcast(WSMessage{Type: "name_changed", Data: map[string]interface{}{"id": id, "name": name}})
		case "get_players":
			log.Printf("📋 Getting all players from database")
			
			rows, err := h.db.Query("SELECT id, name, x, y, color FROM player")
			if err != nil {
				log.Println("❌ db query error:", err)
				continue
			}
			defer rows.Close()

			var chars []Player
			for rows.Next() {
				var c Player
				if err := rows.Scan(&c.ID, &c.Name, &c.X, &c.Y, &c.Color); err != nil {
					log.Println("❌ db scan error:", err)
					continue
				}
				chars = append(chars, c)
			}
			
			log.Printf("📋 Found %d players in database: %v", len(chars), func() []int {
				ids := make([]int, len(chars))
				for i, p := range chars {
					ids[i] = p.ID
				}
				return ids
			}())
			
			client.send <- WSMessage{Type: "players", Data: chars}
		case "control_player":
			data := req.Data.(map[string]interface{})
			playerID := int(data["playerId"].(float64))
			accountID := int(data["accountId"].(float64))
			
			log.Printf("🎮 control_player: account %d trying to control player %d", accountID, playerID)
			
			// Check if player exists before updating foreign key
			var exists bool
			err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM player WHERE id = $1)", playerID).Scan(&exists)
			if err != nil {
				log.Printf("❌ Error checking if player %d exists: %v", playerID, err)
				continue
			}
			
			if !exists {
				log.Printf("❌ Cannot set last_player_id to %d - player does not exist in database", playerID)
				// Set last_player_id to NULL instead of non-existent player
				_, err = h.db.Exec("UPDATE account SET last_player_id = NULL WHERE id = $1", accountID)
				if err != nil {
					log.Printf("❌ Error setting last_player_id to NULL for account %d: %v", accountID, err)
				} else {
					log.Printf("✅ Set last_player_id to NULL for account %d", accountID)
				}
				continue
			}
			
			// Update account's last controlled player
			_, err = h.db.Exec("UPDATE account SET last_player_id = $1 WHERE id = $2", playerID, accountID)
			if err != nil {
				log.Printf("❌ Error updating last player: account=%d, player=%d, error=%v", accountID, playerID, err)
			} else {
				log.Printf("✅ Successfully updated account %d last_player_id to %d", accountID, playerID)
			}
			
		case "save_drawing":
			data := req.Data.(map[string]interface{})
			playerID := int(data["playerId"].(float64))
			image := data["image"].(string)

			_, err := h.db.Exec("INSERT INTO drawing (player_id, image) VALUES ($1, $2)", playerID, image)
			if err != nil {
				log.Println("error saving drawing:", err)
			}

		case "delete_player":
			data := req.Data.(map[string]interface{})
			id := int(data["id"].(float64))
			
			log.Printf("🚫 BLOCKED: Attempted to delete player %d from database (now disabled for persistence)", id)
			
			// Instead of deleting, just broadcast that the player is "removed" from active state
			// but keep them in the database for re-login
			h.Broadcast(WSMessage{
				Type: "player_deleted",
				Data: map[string]interface{}{"id": id},
			})

		case "health_change":
			data := req.Data.(map[string]interface{})
			playerId := int(data["playerId"].(float64))
			newHealth := int(data["health"].(float64))
			changeType := data["type"].(string) // "damage" or "heal"
			
			// Broadcast health change to all clients
			h.Broadcast(WSMessage{
				Type: "health_change",
				Data: map[string]interface{}{
					"playerId": playerId,
					"health": newHealth,
					"type": changeType,
				},
			})

		case "spawn_bullet":
			data := req.Data.(map[string]interface{})
			fromId := int(data["fromId"].(float64))
			targetX := data["targetX"].(float64)
			targetY := data["targetY"].(float64)
			
			// Broadcast bullet spawn to all clients
			h.Broadcast(WSMessage{
				Type: "spawn_bullet",
				Data: map[string]interface{}{
					"fromId": fromId,
					"targetX": targetX,
					"targetY": targetY,
				},
			})

		case "spawn_medkit":
			data := req.Data.(map[string]interface{})
			fromId := int(data["fromId"].(float64))
			targetX := data["targetX"].(float64)
			targetY := data["targetY"].(float64)
			
			// Broadcast med kit spawn to all clients
			h.Broadcast(WSMessage{
				Type: "spawn_medkit",
				Data: map[string]interface{}{
					"fromId": fromId,
					"targetX": targetX,
					"targetY": targetY,
				},
			})

		}
	}
}

func Home(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query("SELECT id, name, x, y, color FROM player")
		if err != nil {
			http.Error(w, "Failed to query player: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var chars []Player
		for rows.Next() {
			var c Player
			if err := rows.Scan(&c.ID, &c.Name, &c.X, &c.Y, &c.Color); err != nil {
				http.Error(w, "Failed to scan row: "+err.Error(), http.StatusInternalServerError)
				return
			}
			chars = append(chars, c)
		}
		tmpl := template.Must(template.ParseFiles("templates/home.html"))
		tmpl.Execute(w, chars)
	}
}

type Account struct {
	ID           int    `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	LastPlayerID *int   `json:"lastPlayerId"`
}

type AuthRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type AuthResponse struct {
	AccountID int    `json:"accountId"`
	Error     string `json:"error,omitempty"`
}

func LoginHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req AuthRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(AuthResponse{Error: "Invalid JSON"})
			return
		}

		var account Account
		err := db.QueryRow("SELECT id, username, password_hash, last_player_id FROM account WHERE username = $1", 
			req.Username).Scan(&account.ID, &account.Username, &account.PasswordHash, &account.LastPlayerID)
		
		if err == sql.ErrNoRows {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(AuthResponse{Error: "Invalid credentials"})
			return
		} else if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(AuthResponse{Error: "Database error"})
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(req.Password)); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(AuthResponse{Error: "Invalid credentials"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AuthResponse{AccountID: account.ID})
	}
}

func RegisterHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req AuthRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(AuthResponse{Error: "Invalid JSON"})
			return
		}

		if len(req.Username) < 3 || len(req.Password) < 6 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(AuthResponse{Error: "Username must be at least 3 characters, password at least 6"})
			return
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(AuthResponse{Error: "Password hashing failed"})
			return
		}

		_, err = db.Exec("INSERT INTO account (username, password_hash) VALUES ($1, $2)", 
			req.Username, string(hashedPassword))
		
		if err != nil {
			if err.Error() == "pq: duplicate key value violates unique constraint \"account_username_key\"" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(AuthResponse{Error: "Username already exists"})
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(AuthResponse{Error: "Database error"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AuthResponse{})
	}
}

func OurgatherPage(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query("SELECT id, name, x, y, color FROM player")
		if err != nil {
			http.Error(w, "Failed to query player: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var chars []Player
		for rows.Next() {
			var c Player
			if err := rows.Scan(&c.ID, &c.Name, &c.X, &c.Y, &c.Color); err != nil {
				http.Error(w, "Failed to scan row: "+err.Error(), http.StatusInternalServerError)
				return
			}
			chars = append(chars, c)
		}

		tmpl := template.Must(template.ParseFiles("templates/ourgatther.html"))
		tmpl.Execute(w, chars)
	}
}

func AccountInfoHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		accountID := r.URL.Query().Get("accountId")
		if accountID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Account ID required"})
			return
		}

		var lastPlayerID *int
		var playerData *Player
		
		// Get account's last player ID
		err := db.QueryRow("SELECT last_player_id FROM account WHERE id = $1", accountID).Scan(&lastPlayerID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Database error"})
			return
		}

		// If there's a last player, get their info
		if lastPlayerID != nil {
			var player Player
			err = db.QueryRow("SELECT id, name, x, y, color FROM player WHERE id = $1", *lastPlayerID).Scan(
				&player.ID, &player.Name, &player.X, &player.Y, &player.Color)
			if err == nil {
				playerData = &player
			}
		}

		response := map[string]interface{}{
			"lastPlayerId": lastPlayerID,
			"lastPlayer":   playerData,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}
}
