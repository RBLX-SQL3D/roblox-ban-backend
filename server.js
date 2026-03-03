const express = require("express")
const axios = require("axios")
const bodyParser = require("body-parser")

const app = express()
app.use(bodyParser.json())

app.get("/", (req, res) => {
    res.send("Backend is running.")
})

app.get("/checkban", (req, res) => {
    const userId = req.query.userId
    res.json({ permanent: false })
})

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});