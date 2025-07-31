# ourgatther

## An attempt to create an open source gather clone

Stack:

Go
Websockets
Postgres
Javascript / HTML / CSS

----

Live deploy:

https://ourgatther.onrender.com/


Install required dependencies:

```
go get github.com/lib/pq github.com/joho/godotenv github.com/DATA-DOG/go-sqlmock

go get nhooyr.io/websocket

```

Run docker with database:

```
sudo docker-compose up --build
```

Run the database on docker:
```
sudo docker start container-name
```

Run the application:
```
go run .
```

Run all tests:

```
go test ./...

# or with coverage:

go test -coverprofile=coverage.out . ./handler
```

Run coverage to generate html visualization:

```
go tool cover -html=coverage.out
```