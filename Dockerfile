FROM python:3.12-slim
WORKDIR /app
COPY server.py index.html style.css app.js questions.json ./
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data
EXPOSE 8080
CMD ["python3", "server.py"]
