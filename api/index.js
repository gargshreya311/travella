const express = require ('express');
const cors = require('cors');
const app=express();
const mongoose=require('mongoose');
require('dotenv').config();
const User = require('./models/User.js');
const bcrypt= require('bcryptjs');
const jwt=require('jsonwebtoken');
const cookieParser=require('cookie-parser');
const imageDownloader=require('image-downloader');
const multer=require('multer');
const fs = require('fs');
const Place=require('./models/Place.js');
const Booking = require('./models/Booking.js');
const {S3Client, PutObjectCommand} = require('@aws-sdk/client-s3');
const mime = require('mime-types');

const bcryptSalt=bcrypt.genSaltSync(10);
const jwtSecret='qwertyuiopasdfghjkl';
const bucket ='travella';

app.use(cookieParser());
app.use(express.json());
app.use("/uploads", express.static(__dirname + "/uploads"));
app.use(cors({
    credentials:true,
    origin:'http://localhost:5173',
}));


async function uploadToS3(path,originalFilename,mimetype){
    const client = new S3Client({
       region:'eu-north-1',  
       credentials:{
        accessKeyId:process.env.S3_ACCESS_KEY,
        secretAccessKey:process.env.S3_SECRET_ACCESS_KEY,
       },
    });
    const parts=originalFilename.split('.');
    const ext = parts[parts.length-1];
    const newFileName=Date.now()+'.'+ext;
    await client.send(new PutObjectCommand({
        Bucket:bucket,
        Body:fs.readFileSync(path),
        Key:newFileName,
        ContentType:mimetype,
        ACL:'public-read',
    }));
    return `https://${bucket}.s3.amazonaws.com/${newFileName}`;
}


function getUserDataFromReq(req){
    return new Promise((resolve,reject)=>{
        jwt.verify(req.cookies.token, jwtSecret, {}, async (err, userData) => {
            if (err) throw err;
            resolve(userData) ;
        });
    });
    
}

app.get('/api/test',(req,res)=>{
    mongoose.connect(process.env.mongo_url);
   res.json('test ok');
});

app.post('/api/register',async(req,res)=>{
    mongoose.connect(process.env.mongo_url);
    const{name,email,password}=req.body;

    try{
       const userDoc = await User.create({
        name,
        email,
        password:bcrypt.hashSync(password,bcryptSalt),
       });

       res.json(userDoc);
    }
    catch(e){
        res.status(422).json(e);
    }
});


app.post('/api/login', async (req, res) => {
    mongoose.connect(process.env.mongo_url);
    const { email, password } = req.body;
    const userDoc = await User.findOne({ email });
    if (!userDoc) {
        return res.status(404).json({ error: 'User not found' });
    }
    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (!passOk) {
        return res.status(422).json({ error: 'Incorrect password' });
    }
    jwt.sign({ email: userDoc.email, id: userDoc._id }, jwtSecret, {}, (err, token) => {
        if (err) {
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.cookie('token', token).json(userDoc);
    });
});



app.get('/api/profile', async (req, res) => {
    mongoose.connect(process.env.mongo_url);
    const { token } = req.cookies;
    if (!token) {
        return res.json(null);
    }
    try {
        const userData = jwt.verify(token, jwtSecret);
        const { name, email, _id } = await User.findById(userData.id);
        res.json({ name, email, _id });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.post('/api/logout',(req,res)=>{
   res.cookie('token','').json(true);
});

app.post('/api/upload-by-link',async(req,res)=>{
    const {link}=req.body;
    const newName='photo'+Date.now()+'.jpg';
    await imageDownloader.image({
         url:link,
         dest:'/tmp/'+newName,
    });
    const url =await uploadToS3('/tmp/'+newName,newName,mime.lookup('/tmp/'+newName));
      
        res.json(url);
       
   
});

const photosMiddleware=multer({dest:'/tmp'});
app.post('/api/upload',photosMiddleware.array('photos',100),async(req,res)=>{
    const uploadedFiles=[];
    for (let i = 0; i < req.files.length; i++) {
        const {path,originalname,mimetype} = req.files[i];
       const url= await uploadToS3(path,originalname,mimetype);
        uploadedFiles.push(url);
    }
     res.json(uploadedFiles);
});

app.post('/api/places', async (req, res) => {
    mongoose.connect(process.env.mongo_url);
    try {
        const { token } = req.cookies;
        const {
            title, address, addedPhotos, description,
            perks, extraInfo, checkIn, checkOut, maxGuests,price,
        } = req.body;
        const userData = jwt.verify(token, jwtSecret);
        const placeDoc = await Place.create({
            owner: userData.id,
            title, address, photos:addedPhotos, description,
            perks, extraInfo, checkIn, checkOut, maxGuests,price,
        });
        res.json(placeDoc);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.get('/api/user-places', async (req, res) => {
    mongoose.connect(process.env.mongo_url);
    try {
        const { token } = req.cookies;
        const userData = jwt.verify(token, jwtSecret);
        const { id } = userData;
        const places = await Place.find({ owner: id });
        res.json(places);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.get('/api/places/:id',async(req,res)=>{
    mongoose.connect(process.env.mongo_url);
      const {id} =req.params;
      res.json(await Place.findById(id));
});

app.put('/api/places', async (req, res) => {
    mongoose.connect(process.env.mongo_url);
       const {token} = req.cookies;
        const {
          id, title,address,addedPhotos,description,
          perks,extraInfo,checkIn,checkOut,maxGuests,price,
        } = req.body;
        jwt.verify(token, jwtSecret, {}, async (err, userData) => {
          if (err) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }
          const placeDoc = await Place.findById(id);
          if (!placeDoc) {
            res.status(404).json({ error: 'Place not found' });
            return;
          }
          if (userData.id !== placeDoc.owner.toString()) {
            res.status(403).json({ error: 'Forbidden' });
            return;
          }
          placeDoc.set({
            title,address,photos:addedPhotos,description,
            perks,extraInfo,checkIn,checkOut,maxGuests,price,
          });
          await placeDoc.save();
          res.json('ok');
        });
});

app.get('/api/places',async(req,res)=>{
    mongoose.connect(process.env.mongo_url);
       res.json(await Place.find());
});

app.post('/api/bookings',async (req,res)=>{
    mongoose.connect(process.env.mongo_url);
    const userData=await getUserDataFromReq(req);
       const{
        place,checkIn,checkOut,numberOfGuests,name,mobile,price,
    }=req.body;
     Booking.create({
        place,checkIn,checkOut,numberOfGuests,name,mobile,price,
        user:userData.id,
    }).then((doc)=>{
        res.json(doc);
    }).catch((err)=>{
        throw err;
    });
});



app.get('/api/bookings',async(req,res)=>{
    mongoose.connect(process.env.mongo_url);
   const userData =  await getUserDataFromReq(req);
   res.json(await Booking.find({user:userData.id}).populate('place'));
});


app.listen(4000);