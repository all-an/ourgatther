package handler

import (
	"database/sql"
	"encoding/json"
	"html/template"
	"math/rand"
	"net/http"
	"strconv"
)

type Character struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
}

func Home(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query("SELECT id, name, x, y FROM character")
		if err != nil {
			http.Error(w, "Failed to query characters: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var chars []Character
		for rows.Next() {
			var c Character
			if err := rows.Scan(&c.ID, &c.Name, &c.X, &c.Y); err != nil {
				http.Error(w, "Failed to scan row: "+err.Error(), http.StatusInternalServerError)
				return
			}
			chars = append(chars, c)
		}
		tmpl := template.Must(template.ParseFiles("templates/home.html"))
		tmpl.Execute(w, chars)
	}
}

func CreateCharacter(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := "Hero" + strconv.Itoa(rand.Intn(1000))
		_, _ = db.Exec("INSERT INTO character (name) VALUES ($1)", name)
		http.Redirect(w, r, "/", http.StatusSeeOther)
	}
}

func ChangeName(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.URL.Query().Get("id"))
		name := r.URL.Query().Get("name")
		if name != "" && id > 0 {
			_, _ = db.Exec("UPDATE character SET name = $1 WHERE id = $2", name, id)
		}
		http.Redirect(w, r, "/", http.StatusSeeOther)
	}
}

func MoveCharacter(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.FormValue("id"))
		x, _ := strconv.Atoi(r.FormValue("x"))
		y, _ := strconv.Atoi(r.FormValue("y"))
		_, _ = db.Exec("UPDATE character SET x = $1, y = $2 WHERE id = $3", x, y, id)
	}
}

func GetCharacters(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, _ := db.Query("SELECT id, name, x, y FROM character")
		var chars []Character
		for rows.Next() {
			var c Character
			_ = rows.Scan(&c.ID, &c.Name, &c.X, &c.Y)
			chars = append(chars, c)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(chars)
	}
}
