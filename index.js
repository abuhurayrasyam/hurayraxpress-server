require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);
const { getAuth } = require("firebase-admin/auth");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('./cloudinaryConfig');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'users-photos',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});

const upload = multer({ storage });

app.post('/upload-image', upload.single('image'), (req, res) => {
    if (!req.file || !req.file.path) {
        return res.status(400).json({ message: 'Image upload failed' });
    }
    res.status(200).json({ imageUrl: req.file.path });
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const database = client.db("hurayra_xpress");
    const usersCollection = database.collection("users");
    const parcelsCollection = database.collection("parcels");
    const paymentsCollection = database.collection("payments");
    const ridersCollection = database.collection('riders');

    // custom middlewares
    const verifyFBToken = async (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).send({ message: 'unauthorized access' })
        }
        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).send({ message: 'unauthorized access' })
        }

        // verify the token
        try {
            const decoded = await admin.auth().verifyIdToken(token);
            req.decoded = decoded;
            next();
        }
        catch (error) {
            return res.status(403).send({ message: 'forbidden access' })
        }
    }

    app.post('/users', async(req, res) => {
        const newUser = req.body;
        const result = await usersCollection.insertOne(newUser);
        res.status(201).send(result);
    })

    app.post('/parcels', verifyFBToken, async(req, res) => {
      const newParcel = req.body;
      const result = await parcelsCollection.insertOne(newParcel);
      res.status(201).send(result);
    })

    app.get('/parcels', verifyFBToken, async (req, res) => {
        const userEmail = req.query.email;

        const query = userEmail ? { created_by: userEmail } : {};
        const options = {
            sort: { createdAt: -1 },
        };

        const parcels = await parcelsCollection.find(query, options).toArray();
        res.send(parcels);
    });

    app.get('/parcels/:id', verifyFBToken, async (req, res) => {
        const id = req.params.id;
        const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });
        if (!parcel) {
            return res.status(404).send({ message: 'Parcel not found' });
        }
        res.send(parcel);
    });

    app.delete('/parcels/:id', verifyFBToken, async (req, res) => {
        const id = req.params.id;
        const query = {_id: new ObjectId(id)};
        const result = await parcelsCollection.deleteOne(query);
        res.send(result);
    });

    app.post('/riders', verifyFBToken, async (req, res) => {
        const rider = req.body;
        const result = await ridersCollection.insertOne(rider);
        res.send(result);
    })

    app.post('/create-payment-intent', async (req, res) => {
        const amountInCents = req.body.amountInCents
        try {
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents,
                currency: 'usd',
                payment_method_types: ['card'],
            });

            res.json({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/payments', verifyFBToken, async (req, res) => {
        try {
            const { parcelId, email, amount, paymentMethod, transactionId } = req.body;

            const updateResult = await parcelsCollection.updateOne(
                { _id: new ObjectId(parcelId) },
                {
                    $set: {
                        payment_status: 'paid'
                    }
                }
            );

            if (updateResult.modifiedCount === 0) {
                return res.status(404).send({ message: 'Parcel not found or already paid' });
            }

            const paymentDoc = {
                parcelId,
                email,
                amount,
                paymentMethod,
                transactionId,
                paid_at_string: new Date().toISOString(),
                paid_at: new Date(),
            };

            const paymentResult = await paymentsCollection.insertOne(paymentDoc);

            res.status(201).send({
                message: 'Payment recorded and parcel marked as paid',
                insertedId: paymentResult.insertedId,
            });

        } catch (error) {
            console.error('Payment processing failed:', error);
            res.status(500).send({ message: 'Failed to record payment' });
        }
    });

    app.get('/payments', verifyFBToken, async (req, res) => {
        try {
            const userEmail = req.query.email;

            const query = userEmail ? { email: userEmail } : {};
            const options = { sort: { paid_at: -1 } };

            const payments = await paymentsCollection.find(query, options).toArray();
            res.send(payments);
        } catch (error) {
            console.error('Error fetching payment history:', error);
            res.status(500).send({ message: 'Failed to get payments' });
        }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Welcome to HurayraXpress Server!')
})

app.listen(port, () => {
  console.log(`HurayraXpress server running on port ${port}`);
})
