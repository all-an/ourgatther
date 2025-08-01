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

func databaseChanges(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS account (
			id SERIAL PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			last_player_id INT,
			created_at TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS player (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			x INT NOT NULL DEFAULT 100,
			y INT NOT NULL DEFAULT 100,
			color TEXT NOT NULL DEFAULT 'teal',
			account_id INT REFERENCES account(id),
			created_at TIMESTAMP DEFAULT NOW()
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

		-- Add foreign key constraint for account's last_player_id (if not exists)
		DO $$ BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_last_player_fkey') THEN
				ALTER TABLE account ADD CONSTRAINT account_last_player_fkey 
					FOREIGN KEY (last_player_id) REFERENCES player(id);
			END IF;
		END $$;

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

	if err := databaseChanges(db); err != nil {
		log.Fatalf("Failed to create tables: %v", err)
	}

	hub := handler.NewHub(db)
	http.HandleFunc("/draw", handler.DrawHandler(db))
	http.HandleFunc("/drawings", handler.GetAllDrawingsHandler(db))
	
	// Auth endpoints
	http.HandleFunc("/login", handler.LoginHandler(db))
	http.HandleFunc("/register", handler.RegisterHandler(db))
	http.HandleFunc("/account-info", handler.AccountInfoHandler(db))

	http.HandleFunc("/ws", hub.WebSocketHandler)
	http.HandleFunc("/", handler.Home(db))
	http.HandleFunc("/ourgatther", handler.OurgatherPage(db))
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	fmt.Println("Server running at http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}
