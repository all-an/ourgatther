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
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	_ = godotenv.Load()

	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return err
	}

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS character (
		id SERIAL PRIMARY KEY,
		name TEXT NOT NULL
	)`); err != nil {
		return err
	}

	http.HandleFunc("/", handler.Home(db))
	http.HandleFunc("/change-name", handler.ChangeName(db))

	fmt.Println("Server running at http://localhost:8080")
	return http.ListenAndServe(":8080", nil)
}
