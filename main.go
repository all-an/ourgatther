package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"

	"ourgatther/handler"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

func createTables(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS player (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			x INT NOT NULL DEFAULT 100,
			y INT NOT NULL DEFAULT 100,
			color TEXT NOT NULL DEFAULT 'teal'
		);

		CREATE TABLE IF NOT EXISTS drawing (
			id SERIAL PRIMARY KEY,
			player_id INT REFERENCES player(id),
			x INT NOT NULL,
			y INT NOT NULL,
			color TEXT NOT NULL DEFAULT 'black',
			size INT NOT NULL DEFAULT 2,
			image TEXT NOT NULL  -- optional: can hold base64 or other encoding of full image
		);

	`)
	return err
}

func main() {
	_ = godotenv.Load()

	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if err := createTables(db); err != nil {
		log.Fatalf("Failed to create tables: %v", err)
	}

	hub := handler.NewHub(db)
	http.HandleFunc("/draw", handler.DrawHandler(db))
	http.HandleFunc("/drawings", handler.GetAllDrawingsHandler(db))

	http.HandleFunc("/ws", hub.WebSocketHandler)
	http.HandleFunc("/", handler.Home(db))
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	fmt.Println("Server running at http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}
