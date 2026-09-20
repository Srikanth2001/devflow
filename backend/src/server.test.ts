import request from "supertest";
import express from "express";

const app = express();
app.get("/health", (_, res) => res.json({ status: "ok" }));

describe("health", () => {
  it("returns ok", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });
});
