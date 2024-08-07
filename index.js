const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
// const Stripe = require("stripe");
// const stripe = Stripe(process.env.STRIPE_KEY);
const cookieParser = require("cookie-parser");
const PORT = process.env.PORT || 8000;

const app = express();

const corsOptions = {
  origin: ["http://localhost:5173"],
  credentials: true,
};

app.use(cors(corsOptions));

app.use(express.json());

app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("yesin");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const username = process.env.DB_USERNAME;
const password = process.env.DB_PASSWORD;

const uri = `mongodb+srv://${username}:${password}@cluster0.0hkunxl.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    const db = client.db("foodApp");
    const userCollection = db.collection("users");
    const paymentCollection = db.collection("payment");
    const menuCollection = db.collection("menu");

    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, {
        expiresIn: "1hr",
      });

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Updated user registration route
    app.put("/user", async (req, res) => {
      const user = req.body;
      console.log(user);
      const isExist = await userCollection.findOne({ email: user.email });
      if (isExist) return;

      // Hash the PIN
      if (user.pin) {
        const hashedPin = await bcrypt.hash(user.pin, 10);

        const data = {
          ...user,
          pin: hashedPin,
        };
      }

      try {
        if (user.pin) {
          const result = await userCollection.insertOne(data);
        } else {
          const result = await userCollection.insertOne(user);
        }
        res.send(result);
      } catch (error) {
        console.error("Error inserting user:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Updated route to find user by PIN and compare provided password
    app.get("/user", async (req, res) => {
      const { email } = req.query;
      const result = await userCollection.findOne({ email });
      const array = [];
      if (!result) {
        return res.status(404);
      }
      res.send(result);
    });

    // Update the POST route for user login
    app.post("/login", async (req, res) => {
      const { email, pin } = req.body;

      if (!email || !pin) {
        return res.status(400).send({
          message: "Email or mobile number and password must be provided",
        });
      }

      try {
        // Find user by email or mobile number
        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        const isMatch = await bcrypt.compare(pin, user.pin);

        if (!isMatch) {
          return res.status(401).send({ message: "Invalid pin" });
        }
        return res.send(user.email);
      } catch (error) {
        console.error("Error finding user or comparing password:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // getting items base on cetegory
    app.get("/food-items", async (req, res) => {
      const { category } = req.query;
      let query = {};

      if (category && category !== "All") {
        query = { category };
      }

      try {
        const result = await menuCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching items:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // single item data
    app.get("/food-item/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await menuCollection.findOne({ _id: new ObjectId(id) });
        if (!result) {
          return res.status(404).send({ message: "Item not found" });
        }
        res.send(result);
      } catch (error) {
        console.error("Error fetching item:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
