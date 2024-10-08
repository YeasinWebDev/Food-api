const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_KEY);
const cookieParser = require("cookie-parser");
const PORT = process.env.PORT || 8000;

const app = express();
const bodyParser = require('body-parser');
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next(); 
  } else {
    // bodyParser.json()(req, res, next); 
    express.json()(req, res, next); 
  }
});
app.use(bodyParser.urlencoded({ extended: true }));


const corsOptions = {
  origin: ["http://localhost:5173","https://foodi-client-lemon.vercel.app"],
  credentials: true,
};

app.use(cors(corsOptions));

// app.use(express.json());

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
    const favCollection = db.collection("fav");
    const cartCollection = db.collection("cart");

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

    // all users 
    app.get('/allUsers',verifyToken, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    })

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
      const { category, page = 1, limit = 6 } = req.query;
      let query = {};

      if (category && category !== "All") {
        query = { category };
      }

      try {
        const skip = (page - 1 ) * limit;
        const result = await menuCollection.find(query).skip(skip).limit(parseInt(limit)).toArray();

        const totalItems = await menuCollection.countDocuments(query)
        const totalPages = Math.ceil(totalItems / limit)

        res.send({items: result, totalPages});
      } catch (error) {
        console.error("Error fetching items:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // get food items base on search
    app.post('/search-items', async (req, res) => {
      const { value } = req.body;
      const limit = 6
      const regex = new RegExp(value, 'i');
      try {
        const result = await menuCollection.find({ name: regex }).toArray();
        const totalItems = await menuCollection.countDocuments({ name: regex })
        const totalPages = Math.ceil(totalItems / limit)
        res.send({items:result, totalPages:totalPages});
      } catch (error) {
        console.error("Error fetching items:", error);
        res.status(500).send("Internal Server Error");
      }
    })

    // post food on database
    app.post('/food-items', verifyToken, async (req, res) => {
      const foodItem = req.body;
      
      try {
          // Fetch the last inserted item to get the highest 'num' value
          const lastItem = await menuCollection.find().sort({ num: -1 }).limit(1).toArray();

          const newNum = lastItem.length > 0 ? lastItem[0].num + 1 : 1;

          foodItem.num = newNum;

          const result = await menuCollection.insertOne(foodItem);
          
          res.send(result);
      } catch (error) {
          console.error("Error inserting item:", error);
          res.status(500).send("Internal Server Error");
      }
  });
  

    // single item data
    app.get("/food-item/:id",verifyToken,async (req, res) => {
      const { id } = req.params;
      try {
        const result = await menuCollection.findOne({ _id: new ObjectId(id) });
        if (!result) {
          return res.status(404).send({ message: "Item not found" });
        }
        
        const categoryData = await menuCollection.find({category: result.category}).toArray()

        res.send({result,categoryData});
      } catch (error) {
        console.error("Error fetching item:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // get all Favorite data
    app.get('/fav', async (req, res) => {
      const {email} = req.query;
      try {
        const result = await favCollection.find({email}, { projection: { num: 1 ,_id:0} }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'An error occurred while fetching favorite item IDs.' });
      }
    })

    // add and remove favorite data
    app.post('/changeFav', async (req, res) => {
      const {item}= req.body
      const isExist = await favCollection.find({email:item.email,}).toArray()

      const databyid = isExist.some(i => i.num === item.num)

      if(databyid) {
        await favCollection.deleteOne({num: item.num,email:item.email})
        return res.send({message: 'Removed from favorite'})
      }else{
        delete item._id
        const result = await favCollection.insertOne(item)
        return res.send({message: 'Added to favorite'})
      }
    })

    // add to cart
    app.post('/cart', async (req, res) => {
      const cart = req.body
      
      const isExist = await cartCollection.findOne({num:cart.num,email:cart.email})
      
      if(isExist) {
        await cartCollection.updateOne({num:cart.num,email:cart.email},{$set: cart})
        return res.send({message: 'Updated in cart'})
      }
      await cartCollection.insertOne(cart)

      res.send({message: 'Added to'})
    })

    // all Cart Data 
    app.post('/allCartData',verifyToken, async (req, res) => {
      const {email} = req.body
      const result = await cartCollection.find({email}).toArray()
      res.send(result)
    })

    // all cart count
    app.post('/allCart', async (req, res) =>{
      const {email} =  req.body
      const result = await cartCollection.find({email}).toArray()
      
      const totalCount = result.reduce((acc, item) => acc + item.count, 0);
      res.send({totalCount})
    })

    // delete a cart
    app.post('/deleteCart',verifyToken, async (req, res) => {
      const {data} =  req.body
      const email = data.email
      const num= data.num
      const result = await cartCollection.deleteOne({ num, email });
      res.send({massage: 'Item deleted successfully'})
    })

    // update a cart qty
    app.post('/updateCart', async (req, res) => {
      const {data} =  req.body
      const num= data.num
      const update = data.type === 'inc' ? { $inc: { count: 1 } } : { $inc: { count: -1 } };

      const result = await cartCollection.updateOne({ num: num,email:data.email }, update)
      res.send({massage: 'Item quantity updated successfully'})
      
    })

    // food realted catagory
    app.get('/foods', async (req, res) => {
      const {category} = req.query
      const result = await menuCollection.find({ category }).toArray();
      res.send(result);
    })

    // randon a catagory
    app.post('/subCategory', async (req, res) =>{
      const {category} = req.body
      const data = await menuCollection.find({ category}).toArray();
      res.send(data)
    })

    // get food by email
    app.get('/myfood',verifyToken, async (req, res) =>{
      const {email} = req.query
      const result = await menuCollection.find({ 
        addedByEmail:email }).toArray();
      res.send(result);
    })

    // update food
    app.put('/updateitem/:id',verifyToken, async (req, res) =>{
      const {id} = req.params
      const updatedItem = req.body
      await menuCollection.updateOne({_id: new ObjectId(id)},{$set: updatedItem})
      res.send({message: 'Food updated successfully'})

    })

    // delete food
    app.delete('/deletefood/:id',verifyToken, async (req, res)=>{
      const {id} = req.params
      
      await menuCollection.deleteOne({_id: new ObjectId(id)})
      res.send({message: 'Food deleted successfully'})
    })

    // get Transition
    app.get('/myTransition', verifyToken, async (req, res)=>{
      const {email} = req.query
      const result = await paymentCollection.find({ email }).toArray();
      res.send(result);
    })

    // get fav list
    app.get('/myFav', verifyToken, async (req, res)=>{
      const {email} = req.query
      const favResult = await favCollection.find({ email }).toArray();
      const favnums = favResult.map(item => item.num);
      const result = await menuCollection.find({num: { $in: favnums } }).toArray();
      res.send(result);
    })

    // statistics 
    app.get("/DashbordStats", verifyToken, async (req, res) => {
      try {
        const totalFoods = await menuCollection.countDocuments();
        const totalUsers = await userCollection.countDocuments();
        const totalCart = await cartCollection.countDocuments();
        const payments = await paymentCollection.find({}).toArray();
        const totalPayemnt = await paymentCollection.countDocuments()
        const totalRevenue = payments.reduce(
          (sum, payment) => sum + payment.totalAmount,
          0
        );
        res.send({
          totalFoods,
          totalUsers,
          totalCart,
          totalPayemnt,
          totalRevenue

        });
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch stats" });
      }
    });

    // payment by stripe
    app.post('/create-checkout-session', async (req, res) => {
      const { cartItems, userEmail } = req.body.payment;
  
      try {
          const lineItems = cartItems.map((item) => ({
              price_data: {
                  currency: 'usd',
                  product_data: {
                      name: item.name,
                      images: [item.img], 
                  },
                  unit_amount: item.price * 100,  
              },
              quantity: item.count,
          }));
  
          const session = await stripe.checkout.sessions.create({
              payment_method_types: ['card'],
              mode: 'payment',
              success_url: `${process.env.FRONTEND_URL}/success`,
              cancel_url: `${process.env.FRONTEND_URL}/`,
              line_items: lineItems,
              customer_email: userEmail,
          });
  
          res.status(200).send({ url: session.url });
      } catch (error) {
          res.status(500).send('Internal Server Error');
      }
  });
  

  app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const body = req.body;
  
    let event;
  
    try {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed.', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  
    // Handle the event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

      if (!lineItems || !lineItems.data) {
        console.error('No line items found for session:', session.id);
        return res.status(500).send('No line items found');
      }
      // return res.status(200).json({lineItems})
      const userEmail = session.customer_email
      const items = await Promise.all(lineItems.data.map(async (item) => {
        // Fetch product details to get the image
        const product = await stripe.products.retrieve(item.price.product);

        return {
            name: item.description,
            img: product.images[0] || '', 
            price: item.amount_subtotal / 100,
            count: item.quantity,
        };
    }));
    
      try {
        const paymentData = {
          email: userEmail,
          items: items,
          paymentData: new Date(),
          paymentStatus: 'Succeeded',
          sessionId: session.id,
          totalAmount: session.amount_total / 100,
        }

        await paymentCollection.insertOne(paymentData);
        await cartCollection.deleteMany({ email: userEmail });
      } catch (error) {
        res.status(500).send('Error saving payment data:', error)
      }
    }
  
    res.status(200).json({ message: 'Event received', event });
  });
  
  

    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
