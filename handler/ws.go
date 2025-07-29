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
			log.Printf("WebSocket disconnected: %v", err)
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
			_, err := h.db.Exec("UPDATE player SET x = $1, y = $2 WHERE id = $3", x, y, id)
			if err != nil {
				log.Println("update error:", err)
				continue
			}
			h.Broadcast(WSMessage{
				Type: "move",
				Data: map[string]interface{}{"id": id, "x": x, "y": y},
			})
		case "create":
			name := req.Data.(map[string]interface{})["name"].(string)
			color := []string{
				"teal", "tomato", "orange", "green", "gold", "pink",
				"cyan", "magenta", "lime", "coral", "brown", "orchid",
				"lightblue", "lightgreen", "khaki", "peachpuff", "lavender"}[rand.Intn(18)]

			x := rand.Intn(800)
			y := rand.Intn(600)
			var id int
			h.db.QueryRow("INSERT INTO player (name, x, y, color) VALUES ($1, $2, $3, $4) RETURNING id", name, x, y, color).Scan(&id)
			player := Player{ID: id, Name: name, X: x, Y: y, Color: color}
			client.send <- WSMessage{Type: "created", Data: player}
			h.Broadcast(WSMessage{Type: "new_player", Data: player})
		case "change_name":
			data := req.Data.(map[string]interface{})
			id := int(data["id"].(float64))
			name := data["name"].(string)
			_, _ = h.db.Exec("UPDATE player SET name = $1 WHERE id = $2", name, id)
			h.Broadcast(WSMessage{Type: "name_changed", Data: map[string]interface{}{"id": id, "name": name}})
		case "get_players":
			rows, err := h.db.Query("SELECT id, name, x, y, color FROM player")
			if err != nil {
				log.Println("db query error:", err)
				continue
			}
			defer rows.Close()

			var chars []Player
			for rows.Next() {
				var c Player
				if err := rows.Scan(&c.ID, &c.Name, &c.X, &c.Y, &c.Color); err != nil {
					log.Println("db scan error:", err)
					continue
				}
				chars = append(chars, c)
			}
			client.send <- WSMessage{Type: "players", Data: chars}

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
