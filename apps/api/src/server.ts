import dotenv from "dotenv";

dotenv.config({path:"../../.env"})

const { default: app } = await import("./app.js");
const { env } = await import("./config/env.js");

const PORT = Number(env.PORT);

app.listen(PORT,()=>{
    console.log(`Server Running on ${PORT}`);
})
