const path = require("path");
const express = require("express");
const apiRouter = require("./routes/api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use("/api", apiRouter);
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`障害福祉サービス加算AI: http://localhost:${PORT} で起動しました`);
});
