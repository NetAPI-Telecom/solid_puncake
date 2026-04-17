FROM eclipse-temurin:17-jdk-alpine
WORKDIR /app
COPY src/App.java src/
RUN javac src/App.java -d .
CMD ["java", "-cp", ".", "App"]
