require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const session = require("express-session");

function normalizeAmazonProduct(product) {

    return {
        source: "Amazon",
        sourceProductId: product.asin,
        name: product.title,
        price: product.price,
        currency: product.currency_code || "INR",
        image: product.image,
        rating: product.rating,
        ratingCount: product.rating_count,
        inStock: product.in_stock,
        productUrl: `https://www.amazon.in/dp/${product.asin}`
    };

}

function normalizeFlipkartProduct(product) {
    return {
        source: "Flipkart",
        sourceProductId: product.product_id,
        name: product.title,
        price: product.price,
        currency: product.currency || "INR",
        image: product.image,
        rating: product.rating,
        ratingCount: product.rating_count,
        inStock: true,
        productUrl: product.url
    };
}

const app = express();

app.use(cors({
    origin: "http://127.0.0.1:5500",
    credentials: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60
    }
}));

app.use(express.json());

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: process.env.DB_PASSWORD,
    database: "PricePulse"
});

db.connect((err) => {
    if (err) {
        console.log("MySQL connection failed:", err);
    } else {
        console.log("MySQL connected successfully!");
    }
});

app.get("/", (req, res) => {
    res.send("PricePulse Backend is Running!");
});


app.post("/signup", async (req, res) => {

    const { name, email, password, confirmPassword } = req.body;

    // Check name
    if (!name || name.trim() === "") {
        return res.status(400).json({
            message: "Name is required."
        });
    }

    // Check email
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !emailPattern.test(email)) {
        return res.status(400).json({
            message: "Please enter a valid email address."
        });
    }

    // Check password length
    if (!password || password.length < 6) {
        return res.status(400).json({
            message: "Password must be at least 6 characters long."
        });
    }

    // Check passwords match
    if (password !== confirmPassword) {
        return res.status(400).json({
            message: "Passwords do not match."
        });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into MySQL
    const sql = `
        INSERT INTO users (name, email, password)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [name, email, hashedPassword], (err, result) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not create account."
            });
        }

        res.json({
            message: "Account created successfully!"
        });
    });
});

app.post("/login", async (req, res) => {

    const { email, password } = req.body;

    // Check email
    if (!email) {
        return res.status(400).json({
            message: "Email is required."
        });
    }

    // Check password
    if (!password) {
        return res.status(400).json({
            message: "Password is required."
        });
    }

    // Find user by email
    const sql = "SELECT * FROM users WHERE email = ?";

    db.query(sql, [email], async (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Something went wrong."
            });
        }

        // User not found
        if (results.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = results[0];

        // Compare entered password with hashed password
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        // Store user in session
        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email
        };

        res.json({
            message: "Login successful!",
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    });
});

app.get("/check-session", (req, res) => {

    if (req.session.user) {
        res.json({
            loggedIn: true,
            user: req.session.user
        });
    } else {
        res.json({
            loggedIn: false
        });
    }
});

app.post("/logout", (req, res) => {

    req.session.destroy((err) => {

        if (err) {
            return res.status(500).json({
                message: "Could not log out."
            });
        }

        res.clearCookie("connect.sid");

        res.json({
            message: "Logged out successfully!"
        });
    });
});

app.get("/products", (req, res) => {

    const search = req.query.search;
    const category = req.query.category;

    let sql = `
        SELECT
            p.id,
            p.name,
            p.category,
            p.description,
            p.image_url,
            p.created_at,
            pp.price,
            pp.seller,
            pp.discount
        FROM products p
        LEFT JOIN product_prices pp
            ON p.id = pp.product_id
        WHERE pp.price = (
            SELECT MIN(pp2.price)
            FROM product_prices pp2
            WHERE pp2.product_id = p.id
        )
    `;

    let conditions = [];
    let values = [];

    if (search && search.trim() !== "") {

        conditions.push(`
            (
                p.name LIKE ?
                OR p.category LIKE ?
            )
        `);

        const searchValue = `%${search}%`;

        values.push(searchValue, searchValue);
    }

    if (category && category.trim() !== "") {

        conditions.push("p.category = ?");

        values.push(category);
    }

    if (conditions.length > 0) {

        sql += " AND " + conditions.join(" AND ");

    }

    db.query(sql, values, (err, results) => {

        if (err) {

            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch products."
            });

        }

        res.json(results);

    });

});

app.get("/products/find", (req, res) => {

    const name = req.query.name;

    if (!name) {
        return res.status(400).json({
            message: "Product name is required."
        });
    }

    const sql = `
        SELECT *
        FROM products
        WHERE name = ?
        LIMIT 1
    `;

    db.query(sql, [name], (err, results) => {

        if (err) {

            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not find product."
            });

        }

        if (results.length === 0) {

            return res.json({
                found: false
            });

        }

        res.json({
            found: true,
            product: results[0]
        });

    });

});

app.post("/products", (req, res) => {

    const {
        name,
        category,
        description,
        imageUrl
    } = req.body;

    if (!name || !category) {
        return res.status(400).json({
            message: "Product name and category are required."
        });
    }

    const sql = `
        INSERT INTO products
        (name, category, description, image_url)
        VALUES (?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            name,
            category,
            description || null,
            imageUrl || null
        ],
        (err, result) => {

            if (err) {

                console.log("Database error:", err);

                return res.status(500).json({
                    message: "Could not create product."
                });

            }

            res.json({
                message: "Product created successfully.",
                productId: result.insertId
            });

        }
    );

});

app.get("/products/:id", (req, res) => {

    const productId = req.params.id;

    const sql = `
        SELECT
            p.id,
            p.name,
            p.category,
            p.description,
            p.image_url,
            p.created_at,
            pp.price,
            pp.seller,
            pp.discount
        FROM products p
        LEFT JOIN product_prices pp
            ON p.id = pp.product_id
        WHERE p.id = ?
        AND pp.price = (
            SELECT MIN(pp2.price)
            FROM product_prices pp2
            WHERE pp2.product_id = p.id
        )
    `;

    db.query(sql, [productId], (err, results) => {

        if (err) {

            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch product."
            });

        }

        if (results.length === 0) {

            return res.status(404).json({
                message: "Product not found."
            });

        }

        res.json(results[0]);

    });

});

app.get("/products/:id/prices", (req, res) => {

    const productId = req.params.id;

    const sql = `
        SELECT *
        FROM product_prices
        WHERE product_id = ?
        ORDER BY price ASC
    `;

    db.query(sql, [productId], (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch seller prices."
            });
        }

        res.json(results);

    });

});

app.put("/products/:id/prices/:seller", (req, res) => {

    const productId = req.params.id;
    const seller = req.params.seller;

    const { price, discount } = req.body;

    if (price === undefined) {
        return res.status(400).json({
            message: "Price is required."
        });
    }

    const sql = `
        UPDATE product_prices
        SET price = ?, discount = ?
        WHERE product_id = ?
        AND seller = ?
    `;

    db.query(
        sql,
        [price, discount || 0, productId, seller],
        (err, result) => {

            if (err) {
                console.log("Database error:", err);

                return res.status(500).json({
                    message: "Could not update product price."
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Product seller combination not found."
                });
            }

            res.json({
                message: "Product price updated successfully."
            });

        }
    );

});

app.get("/products/:id/price-history", (req, res) => {

    const productId = req.params.id;

    const sql = `
        SELECT
            seller,
            price,
            recorded_at
        FROM price_history
        WHERE product_id = ?
        ORDER BY recorded_at ASC
    `;

    db.query(sql, [productId], (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch price history."
            });
        }

        res.json(results);

    });

});

app.get("/products/:id/price-insights", (req, res) => {

    const productId = req.params.id;

    const sql = `
        SELECT
            MIN(price) AS lowestPrice,
            MAX(price) AS highestPrice,
            AVG(price) AS averagePrice
        FROM price_history
        WHERE product_id = ?
    `;

    db.query(sql, [productId], (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch price insights."
            });
        }

        res.json(results[0]);

    });

});

app.get("/products/:id/buy-wait", (req, res) => {

    const productId = req.params.id;

    const sql = `
        SELECT
            MIN(price) AS lowestPrice,
            MAX(price) AS highestPrice,
            AVG(price) AS averagePrice
        FROM price_history
        WHERE product_id = ?
    `;

    db.query(sql, [productId], (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not calculate buy-wait insight."
            });
        }

        const data = results[0];

        if (data.lowestPrice === null) {
            return res.status(404).json({
                message: "No price history found for this product."
            });
        }

        const lowestPrice = Number(data.lowestPrice);
        const highestPrice = Number(data.highestPrice);
        const averagePrice = Number(data.averagePrice);

        const latestSql = `
            SELECT price
            FROM price_history
            WHERE product_id = ?
            ORDER BY recorded_at DESC
            LIMIT 1
        `;

        db.query(latestSql, [productId], (err, latestResults) => {

            if (err) {
                console.log("Database error:", err);

                return res.status(500).json({
                    message: "Could not fetch current price."
                });
            }

            if (latestResults.length === 0) {
                return res.status(404).json({
                    message: "No current price found."
                });
            }

            const currentPrice = Number(latestResults[0].price);

            // Calculate where the current price lies
            // between the historical lowest and highest price.

            const priceRange =
                highestPrice - lowestPrice;

            let pricePosition = 0;

            if (priceRange > 0) {

                pricePosition =
                    ((currentPrice - lowestPrice) / priceRange) * 100;

            }

            let decision;
            let message;

            if (pricePosition <= 30) {

                decision = "BUY";

                message =
                    "The current price is close to the historical lowest price.";

            } else if (pricePosition <= 70) {

                decision = "CONSIDER";

                message =
                    "The current price is around the middle of its historical price range.";

            } else {

                decision = "WAIT";

                message =
                    "The current price is close to the historical highest price.";

            }

            res.json({

                currentPrice: currentPrice,

                lowestPrice: lowestPrice,

                highestPrice: highestPrice,

                averagePrice:
                    Number(averagePrice.toFixed(2)),

                pricePosition:
                    Number(pricePosition.toFixed(2)),

                decision: decision,

                message: message

            });

        });

    });

});

app.get("/categories", (req, res) => {
    res.send("Categories data will come here.");
});

app.get("/about", (req, res) => {
    res.send("Welcome to PricePulse.");
});

app.get("/analytics/overview", (req, res) => {

    const sql = `
        SELECT
            MIN(price) AS lowestPrice,
            AVG(price) AS averagePrice,
            MAX(discount) AS highestDiscount,
            COUNT(DISTINCT product_id) AS totalProducts
        FROM product_prices
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch analytics data."
            });
        }

        res.json(results[0]);
    });
});

app.get("/analytics/products", (req, res) => {

    const sql = `
        SELECT
            p.id,
            p.name,
            p.category,
            MIN(pp.price) AS lowestPrice,
            MAX(pp.price) AS highestPrice,
            AVG(pp.price) AS averagePrice,
            (MAX(pp.price) - MIN(pp.price)) AS savings
        FROM products p
        JOIN product_prices pp
            ON p.id = pp.product_id
        GROUP BY p.id, p.name, p.category
        ORDER BY savings DESC
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch product analytics."
            });
        }

        res.json(results);
    });
});

app.get("/analytics/categories", (req, res) => {

    const sql = `
        SELECT
            category,
            COUNT(*) AS totalProducts,
            MIN(lowestPrice) AS lowestPrice,
            AVG(productAveragePrice) AS averagePrice,
            MAX(highestDiscount) AS highestDiscount
        FROM (

            SELECT
                p.id,
                p.category,
                AVG(pp.price) AS productAveragePrice,
                MIN(pp.price) AS lowestPrice,
                MAX(pp.discount) AS highestDiscount

            FROM products p

            JOIN product_prices pp
                ON p.id = pp.product_id

            GROUP BY p.id, p.category

        ) AS productStats

        GROUP BY category

        ORDER BY averagePrice ASC
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch category analytics."
            });
        }

        res.json(results);
    });
});

app.get("/analytics/deals", (req, res) => {

    const sql = `
        SELECT
            p.id,
            p.name,
            p.category,
            pp.price,
            pp.seller,
            pp.discount
        FROM products p
        JOIN product_prices pp
            ON p.id = pp.product_id
        WHERE pp.discount = (
            SELECT MAX(pp2.discount)
            FROM product_prices pp2
            WHERE pp2.product_id = p.id
        )
        ORDER BY pp.discount DESC, pp.price ASC
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log("Database error:", err);

            return res.status(500).json({
                message: "Could not fetch best deals."
            });
        }

        res.json(results);
    });
});

app.get("/amazon-search", async (req, res) => {

    try {

        const query = req.query.query;

        if (!query) {
            return res.status(400).json({
                message: "Search query is required."
            });
        }

        const response = await fetch(
            "https://api.reefapi.com/amazon/v1/search",
            {
                method: "POST",
                headers: {
                    "x-api-key": process.env.REEF_KEY,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    query: query,
                    marketplace: "in"
                })
            }
        );

        const data = await response.json();

        if (
            data.data &&
            data.data.results &&
            Array.isArray(data.data.results)
        ) {

            data.data.results =
                data.data.results.map(normalizeAmazonProduct);

        }

        res.json(data);

    } catch (error) {

        console.log("Amazon Search API error:", error);

        res.status(500).json({
            message: "Could not search Amazon."
        });

    }

});

// Flipkart Search API
app.get("/flipkart-search", async (req, res) => {
    try {
        const query = req.query.query;

        if (!query) {
            return res.status(400).json({
                message: "Search query is required."
            });
        }

        const response = await fetch(
            "https://api.reefapi.com/flipkart/v1/search",
            {
                method: "POST",
                headers: {
                    "x-api-key": process.env.REEF_KEY,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    query: query,
                    marketplace: "in"
                })
            }
        );

        const data = await response.json();

        if (
            data.data &&
            data.data.results &&
            Array.isArray(data.data.results)
        ) {
            data.data.results =
                data.data.results.map(normalizeFlipkartProduct);
        }

        res.json(data);

    } catch (error) {
        console.log("Flipkart Search API error:", error);

        res.status(500).json({
            message: "Could not search Flipkart."
        });
    }
});

app.get("/amazon-offers", async (req, res) => {

    try {

        const asin = req.query.asin;

        if (!asin) {
            return res.status(400).json({
                message: "ASIN is required."
            });
        }

        const response = await fetch(
            "https://api.reefapi.com/amazon/v1/product/offers",
            {
                method: "POST",
                headers: {
                    "x-api-key": process.env.REEF_KEY,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    asin: asin,
                    marketplace: "in"
                })
            }
        );

        const data = await response.json();

        res.json(data);

    } catch (error) {

        console.log("Amazon Offers API error:", error);

        res.status(500).json({
            message: "Could not fetch Amazon offers."
        });

    }

});

app.get("/reef-test", async (req, res) => {

    try {

        const response = await fetch(
            "https://api.reefapi.com/amazon/v1/product/offers",
            {
                method: "POST",
                headers: {
                    "x-api-key": process.env.REEF_KEY,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    asin: "B0CS69QQTG",
                    marketplace: "in"
                })
            }
        );

        const data = await response.json();

        res.json(data);

    } catch (error) {

        console.log("ReefAPI error:", error);

        res.status(500).json({
            message: "Could not connect to ReefAPI."
        });

    }

});

app.get("/flipkart-test", async (req, res) => {
    try {
        const response = await fetch(
            "https://api.reefapi.com/flipkart/v1/search",
            {
                method: "POST",
                headers: {
                    "x-api-key": process.env.REEF_KEY,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    query: "iPhone 15",
                    marketplace: "in"
                })
            }
        );

        const data = await response.json();

        res.json(data);

    } catch (error) {
        console.log("Flipkart ReefAPI error:", error);

        res.status(500).json({
            message: "Could not connect to Flipkart ReefAPI."
        });
    }
});

app.post("/product-sources", (req, res) => {

    const {
        productId,
        source,
        sourceProductId,
        productUrl
    } = req.body;

    if (!productId || !source || !sourceProductId) {
        return res.status(400).json({
            message: "Product source information is required."
        });
    }

    const sql = `
        INSERT INTO product_sources
        (product_id, source, source_product_id, product_url)
        VALUES (?, ?, ?, ?)
    `;

    db.query(
        sql,
        [productId, source, sourceProductId, productUrl || null],
        (err, result) => {

            if (err) {

                console.log("Database error:", err);

                return res.status(500).json({
                    message: "Could not save product source."
                });

            }

            res.json({
                message: "Product source saved successfully.",
                sourceId: result.insertId
            });

        }
    );

});

app.get("/product-sources/:source/:sourceProductId", (req, res) => {

    const source = req.params.source;
    const sourceProductId = req.params.sourceProductId;

    const sql = `
        SELECT *
        FROM product_sources
        WHERE source = ?
        AND source_product_id = ?
    `;

    db.query(
        sql,
        [source, sourceProductId],
        (err, results) => {

            if (err) {

                console.log("Database error:", err);

                return res.status(500).json({
                    message: "Could not check product source."
                });

            }

            if (results.length === 0) {

                return res.json({
                    exists: false
                });

            }

            res.json({
                exists: true,
                source: results[0]
            });

        }
    );

});

app.post("/product-prices", (req, res) => {

    const {
        productId,
        seller,
        price,
        discount,
        productUrl
    } = req.body;

    if (!productId || !seller || price === undefined) {
        return res.status(400).json({
            message: "Product ID, seller and price are required."
        });
    }

    const sql = `
        INSERT INTO product_prices
        (product_id, seller, price, discount, product_url)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            price = VALUES(price),
            discount = VALUES(discount),
            product_url = VALUES(product_url)
    `;

    db.query(
        sql,
        [
            productId,
            seller,
            price,
            discount || 0,
            productUrl || null
        ],
        (err, result) => {

            if (err) {

                console.log("Database error:", err);

                return res.status(500).json({
                    message: "Could not save product price."
                });

            }

            res.json({
                message: "Product price saved successfully."
            });

        }
    );

});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});