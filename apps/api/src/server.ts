import dotenv from "dotenv";

dotenv.config({path:"../../.env"})

const { default: app } = await import("./app.js");

const PORT= process.env.PORT;

app.listen(PORT,()=>{
    console.log(`Server Running on ${PORT}`);
}) 