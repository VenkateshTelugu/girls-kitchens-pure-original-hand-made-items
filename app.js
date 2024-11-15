const express = require("express");
const session = require('express-session');
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");
const hbs = require('hbs');

const url = "mongodb://localhost:27017/yourDatabaseName";
const dbName = "FoodDelivery";
const client = new MongoClient(url);

const app = express();
const publicDirectoryPath = path.join(__dirname, "./public");

app.use(express.static(publicDirectoryPath));
app.set("view engine", "hbs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: '8d6f3e9d939ac72f8d3e4cb0a7b48f05',
  resave: false,
  saveUninitialized: true,
}));

let db;

async function connectToDatabase() {
  try {
    await client.connect();
    db = client.db(dbName);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}
connectToDatabase();

// Register route (GET)
app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { name, email, phone, password, role, street, city, state, pincode } = req.body;

  try {
    const newUser = {
      name,
      email,
      phone,
      password,  // Storing plain text password (not hashed)
      role,
      address: { street, city, state, pincode }
    };

    await db.collection("Users").insertOne(newUser);
    res.redirect("/login"); // Redirect to login after successful registration
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).send("Error registering user: " + error.message);
  }
});



// Login route (GET)
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { name, password } = req.body;

  try {
    // Authenticate user by email
    const user = await db.collection("Users").findOne({ name });
    
    // If no user found or password doesn't match, return error
    if (!user) {
      console.log("User not found");
      return res.status(401).send("Invalid credentials");
    }
  
    if (user.password !== password) {
      console.log("Password mismatch");
      return res.status(401).send("Invalid credentials");
    }

    // Store user ID and role in session
    req.session.userId = user._id;
    req.session.role = user.role;

    // Redirect based on role
    if (user.role === "customer") {
      return res.redirect("/customer-home");
    } else if (user.role === "restaurant_owner") {
      return res.redirect("/restaurant-owner-home");
    } else if (user.role === "delivery_person") {
      return res.redirect("/driver-home");
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).send("Internal server error");
  }
});


app.get("/check-session", (req, res) => {
  if (!req.session.userId) {
    return res.send("No user logged in");
  }
  res.send(`Logged in as ${req.session.userId} with role ${req.session.role}`);
});



// Customer home route
app.get("/customer-home", async (req, res) => {
  if (!req.session.userId || req.session.role !== "customer") {
    return res.redirect("/login");
  }

  try {
    const restaurants = await db.collection("Restaurant").find().toArray();
    res.render("customer-home", { restaurants });
  } catch (error) {
    console.error("Error loading customer home:", error);
    res.status(500).send("Error loading customer home");
  }
});

// Restaurant owner home route
app.get("/restaurant-owner-home", async (req, res) => {
  if (!req.session.userId || req.session.role !== "restaurant_owner") {
    return res.redirect("/login");
  }

  try {
    const user = await db.collection("Users").findOne({ _id: new ObjectId(req.session.userId) });
    const restaurant = await db.collection("Restaurant").findOne({ ownerId: user._id });
    res.render("restaurant-owner-home", { restaurant });
  } catch (error) {
    console.error("Error loading restaurant owner home:", error);
    res.status(500).send("Error loading restaurant owner home");
  }
});



app.get("/orders", async (req, res) => {
  try {
    const orders = await db.collection("Orders").aggregate([
      {
        $lookup: {
          from: "Menu",
          localField: "menuItemId",
          foreignField: "_id",
          as: "menuItem"
        }
      },
      { $unwind: "$menuItem" }, // Flatten the menuItem array
      {
        $lookup: {
          from: "Users",
          localField: "customerId",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: "$customer" } // Flatten the customer array
    ]).toArray();

    res.render("orders", { orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).send("Error fetching orders");
  }
});



app.post("/order", async (req, res) => {
  const { menuItems, quantity, restaurantId } = req.body;

  // Ensure the user is logged in and has the 'customer' role
  if (!req.session.userId || req.session.role !== "customer") {
    return res.status(401).send("Unauthorized");
  }

  // Make sure at least one menu item is selected
  if (!menuItems || menuItems.length === 0) {
    return res.status(400).send("No menu items selected.");
  }

  try {
    // Initialize an array to hold the orders
    const orders = [];

    // Loop over the selected menu items
    for (let i = 0; i < menuItems.length; i++) {
      const menuItemId = menuItems[i];
      const itemQuantity = quantity[menuItemId] ? parseInt(quantity[menuItemId]) : 1;

      // Get the menu item details
      const menuItem = await db.collection("Menu").findOne({ _id: new ObjectId(menuItemId) });

      if (!menuItem) {
        return res.status(404).send("Menu item not found");
      }

      // Calculate the total price for this item
      const totalPrice = menuItem.price * itemQuantity;

      // Create the order object
      const order = {
        customerId: new ObjectId(req.session.userId),
        restaurantId: new ObjectId(restaurantId),
        menuItemId: new ObjectId(menuItemId),
        quantity: itemQuantity,
        totalPrice,
        status: "Pending",
        createdAt: new Date(),
      };

      orders.push(order);
    }

    // Insert the orders into the Orders collection
    await db.collection("Orders").insertMany(orders);

    // Redirect to the orders page after placing the order
    res.redirect("/orders");
  } catch (error) {
    console.error("Error placing order:", error);
    res.status(500).send("Internal Server Error");
  }
});





app.get("/menu", async (req, res) => {
  if (!req.session.userId || req.session.role !== "restaurant_owner") {
    return res.redirect("/login");
  }

  try {
    // Find the restaurant owned by the logged-in user
    const restaurant = await db.collection("Restaurant").findOne({ ownerId: new ObjectId(req.session.userId) });

    if (!restaurant) {
      return res.status(400).send("No restaurant found for the logged-in user");
    }

    // Fetch menu items linked to the restaurant
    const menuItems = await db.collection("Menu").find({ restaurantId: restaurant._id }).toArray();
    res.render("menu", { menuItems, restaurant });
  } catch (error) {
    console.error("Error loading menu:", error);
    res.status(500).send("Error loading menu");
  }
});


app.post("/menu", async (req, res) => {
  const { name, description, price, category, availability } = req.body;

  try {
    // Find the restaurant associated with the logged-in owner
    const restaurant = await db.collection("Restaurant").findOne({
      ownerId: new ObjectId(req.session.userId),
    });

    if (!restaurant) {
      return res.status(400).send("No restaurant found for the logged-in owner.");
    }

    // Create a new menu item linked to the restaurant
    const newMenuItem = {
      name,
      description,
      price: parseFloat(price),
      category,
      availability: availability === "true", // Convert string to boolean
      restaurantId: restaurant._id, // Link menu item to the restaurant
    };

    // Insert the menu item into the Menu collection
    await db.collection("Menu").insertOne(newMenuItem);

    console.log("Menu item added successfully:", newMenuItem);
    res.redirect("/restaurant-owner-home"); // Redirect after adding the item
  } catch (error) {
    console.error("Error adding menu item:", error);
    res.status(500).send("Error adding menu item.");
  }
});




app.get("/driver-home", async (req, res) => {
  if (!req.session.userId || req.session.role !== "delivery_person") {
    return res.redirect("/login");
  }

  try {
    const orders = await db.collection("Orders").find({ deliveryPersonId: new ObjectId(req.session.userId) }).toArray();
    res.render("driver-home", { orders });
  } catch (error) {
    console.error("Error loading driver home:", error);
    res.status(500).send("Error loading driver home");
  }
});


app.get("/details", async (req, res) => {
  if (!req.session.userId || req.session.role !== "restaurant_owner") {
    return res.redirect("/login");
  }

  try {
    const restaurant = await db.collection("Restaurant").findOne({
      ownerId: new ObjectId(req.session.userId),
    });

    res.render("details", {
      restaurant: restaurant || {},
    });
  } catch (error) {
    console.error("Error loading restaurant details:", error);
    res.status(500).send("Error loading restaurant details.");
  }
});


app.post("/details", async (req, res) => {
  const { name, street, city, state, pincode } = req.body;

  if (!req.session.userId || req.session.role !== "restaurant_owner") {
    return res.redirect("/login");
  }

  try {
    // Upsert restaurant details (insert if not exists, update if exists)
    await db.collection("Restaurant").updateOne(
      { ownerId: new ObjectId(req.session.userId) }, // Match the owner
      {
        $set: {
          ownerId: new ObjectId(req.session.userId),
          name,
          address: {
            street,
            city,
            state,
            pincode,
          },
        },
      },
      { upsert: true }
    );

    res.redirect("/restaurant-owner-home");
  } catch (error) {
    console.error("Error saving restaurant details:", error);
    res.status(500).send("Error saving restaurant details.");
  }
});



app.get("/customer-home", async (req, res) => {
  if (!req.session.userId || req.session.role !== "customer") {
    return res.redirect("/login");
  }

  try {
    const restaurants = await db.collection("Restaurant").find().toArray(); // Retrieve all restaurants
    res.render("customer-home", { restaurants });
  } catch (error) {
    console.error("Error loading customer home:", error);
    res.status(500).send("Error loading customer home");
  }
});


app.get("/restaurant/:id", async (req, res) => {
  // Extract the restaurant ID from the URL parameters
  const restaurantId = req.params.id;

  try {
    // Fetch the restaurant details from the "Restaurant" collection
    const restaurant = await db.collection("Restaurant").findOne({
      _id: new ObjectId(restaurantId), // Use the ID of the restaurant passed in the URL
    });

    // Fetch the menu items associated with this restaurant from the "Menu" collection
    const menu = await db.collection("Menu").find({
      restaurantId: new ObjectId(restaurantId), // Filter menu items by the restaurant ID
    }).toArray();

    // Render the "restaurant-menu" view and pass the restaurant and menu data to it
    res.render("restaurant-menu", { restaurant, menu });
  } catch (error) {
    console.error("Error fetching restaurant menu:", error);
    res.status(500).send("Error fetching menu."); // Handle any errors
  }
});



const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
