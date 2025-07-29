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

func main() {
	_ = godotenv.Load()

	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS character (
		id SERIAL PRIMARY KEY,
		name TEXT NOT NULL,
		x INT NOT NULL DEFAULT 100,
		y INT NOT NULL DEFAULT 100
	)`)
	if err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/", handler.Home(db))
	http.HandleFunc("/create-character", handler.CreateCharacter(db))
	http.HandleFunc("/change-name", handler.ChangeName(db))
	http.HandleFunc("/move", handler.MoveCharacter(db))
	http.HandleFunc("/characters", handler.GetCharacters(db))

	fmt.Println("Server running at http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}
