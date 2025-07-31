package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type DrawingPoint struct {
	X        int    `json:"x"`
	Y        int    `json:"y"`
	Color    string `json:"color"`
	Size     int    `json:"size"`
	PlayerID int    `json:"player_id"`
}

func DrawHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var point DrawingPoint
		if err := json.NewDecoder(r.Body).Decode(&point); err != nil {
			http.Error(w, "Invalid input", http.StatusBadRequest)
			return
		}

		_, err := db.Exec(`
				INSERT INTO drawing (player_id, x, y, color, size, image)
				VALUES ($1, $2, $3, $4, $5, '')
			`, point.PlayerID, point.X, point.Y, point.Color, point.Size)

		if err != nil {
			http.Error(w, "Failed to save drawing", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
	}
}

func GetAllDrawingsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(`SELECT x, y, color, size FROM drawing`)
		if err != nil {
			http.Error(w, "Failed to fetch drawings", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var drawings []DrawingPoint
		for rows.Next() {
			var p DrawingPoint
			if err := rows.Scan(&p.X, &p.Y, &p.Color, &p.Size); err == nil {
				drawings = append(drawings, p)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(drawings)
	}
}
