package handler

import (
	"database/sql"
	"html/template"
	"net/http"
)

func Home(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var name string
		_ = db.QueryRow("SELECT name FROM character WHERE id = 1").Scan(&name)
		if name == "" {
			name = "Hero"
			_, _ = db.Exec("INSERT INTO character (id, name) VALUES (1, $1) ON CONFLICT (id) DO NOTHING", name)
		}

		tmpl := template.Must(template.ParseFiles("templates/home.html"))
		tmpl.Execute(w, map[string]string{"Name": name})
	}
}

func ChangeName(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		if name != "" {
			_, _ = db.Exec("UPDATE character SET name = $1 WHERE id = 1", name)
		}
		http.Redirect(w, r, "/", http.StatusSeeOther)
	}
}
