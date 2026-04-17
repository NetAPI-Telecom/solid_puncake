FROM golang:1.21-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY main.go .
RUN go build -o server main.go

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/server .
CMD ["./server"]
