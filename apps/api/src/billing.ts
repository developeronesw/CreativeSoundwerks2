import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { pool, query } from "./db.js";
import { requireActor, requireRole } from "./auth.js";

function stripe(){
 const key=process.env.STRIPE_SECRET_KEY;
 if(!key)throw Object.assign(new Error("Stripe is not configured"),{statusCode:503});
 return new Stripe(key);
}
const uid=z.uuid();
export async function billingRoutes(app:FastifyInstance){
 app.get("/api/plans",async()=>({items:(await query<any>("SELECT id,audience,name,description,amount_cents,currency,interval,upload_limit,features FROM plans WHERE active=true ORDER BY audience,amount_cents")).rows}));
 app.get("/api/admin/plans",async req=>{
  await requireRole(req,["admin"]);return {items:(await query("SELECT * FROM plans ORDER BY audience,amount_cents")).rows};
 });
 app.patch("/api/admin/plans/:id",async(req,reply)=>{
  await requireRole(req,["admin"]);
  const id=uid.parse((req.params as any).id);
  const v=z.object({name:z.string().min(2).max(100).optional(),description:z.string().max(1000).optional(),amountCents:z.number().int().min(0).max(10000000).optional(),uploadLimit:z.number().int().min(0).max(1000000).optional(),features:z.array(z.string().max(120)).max(20).optional(),active:z.boolean().optional()}).strict().parse(req.body);
  const r=await query("UPDATE plans SET name=coalesce($2,name),description=coalesce($3,description),amount_cents=coalesce($4,amount_cents),upload_limit=coalesce($5,upload_limit),features=coalesce($6::jsonb,features),active=coalesce($7,active),updated_at=now() WHERE id=$1 RETURNING *",[id,v.name??null,v.description??null,v.amountCents??null,v.uploadLimit??null,v.features?JSON.stringify(v.features):null,v.active??null]);
  if(!r.rowCount)return reply.code(404).send({error:"Plan not found"});
  return {item:r.rows[0]};
 });
 app.get("/api/subscriptions/mine",async req=>{
  const u=await requireActor(req);
  return {items:(await query("SELECT s.id,s.status,s.current_period_end,p.name,p.audience,p.amount_cents FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 ORDER BY s.created_at DESC",[u.id])).rows};
 });
 app.post("/api/checkout/plan",async(req,reply)=>{
  const u=await requireActor(req);const {planId}=z.object({planId:uid}).parse(req.body);
  const result=await query<any>("SELECT * FROM plans WHERE id=$1 AND active=true",[planId]);const plan=result.rows[0];
  if(!plan)return reply.code(404).send({error:"Plan not found"});
  if(u.role!=="admin" && plan.audience!==(u.role==="creator"?"creator":"fan"))return reply.code(403).send({error:"Plan does not match account"});
  if(plan.amount_cents===0)return reply.code(400).send({error:"Free plans do not require Stripe checkout"});
  const id=randomUUID();
  const session=await stripe().checkout.sessions.create({
   mode:"subscription",success_url:process.env.PUBLIC_APP_URL+"/?checkout=success",
   cancel_url:process.env.PUBLIC_APP_URL+"/pricing?checkout=cancel",
   customer_email:u.email,
   line_items:[{price_data:{currency:plan.currency,unit_amount:plan.amount_cents,recurring:{interval:plan.interval},product_data:{name:plan.name}},quantity:1}],
   subscription_data:{metadata:{userId:u.id,planId:plan.id,internalId:id}},
   metadata:{userId:u.id,planId:plan.id,internalId:id}
  });
  await query("INSERT INTO subscriptions(id,user_id,plan_id,status) VALUES($1,$2,$3,'pending')",[id,u.id,plan.id]);
  return {url:session.url};
 });
 app.get("/api/cart",async req=>{
  const u=await requireActor(req);
  return {items:(await query("SELECT m.id,m.title,m.kind,m.price_cents FROM carts c JOIN media m ON m.id=c.media_id WHERE c.user_id=$1 ORDER BY c.created_at DESC",[u.id])).rows};
 });
 app.post("/api/cart",async(req,reply)=>{
  const u=await requireActor(req);const {mediaId}=z.object({mediaId:uid}).parse(req.body);
  const r=await query("INSERT INTO carts(user_id,media_id) SELECT $1,id FROM media WHERE id=$2 AND visibility='published' AND price_cents>0 AND owner_id<>$1 AND NOT EXISTS (SELECT 1 FROM purchases WHERE user_id=$1 AND media_id=$2) ON CONFLICT DO NOTHING RETURNING media_id",[u.id,mediaId]);
  if(!r.rowCount)return reply.code(400).send({error:"Not available for purchase or already purchased"});
  return {ok:true};
 });
 app.delete("/api/cart/:id",async req=>{
  const u=await requireActor(req);const id=uid.parse((req.params as any).id);
  await query("DELETE FROM carts WHERE user_id=$1 AND media_id=$2",[u.id,id]);return {ok:true};
 });
 app.post("/api/checkout/cart",async(req,reply)=>{
  const u=await requireActor(req);
  const items=(await query<any>("SELECT m.id,m.title,m.price_cents FROM carts c JOIN media m ON m.id=c.media_id WHERE c.user_id=$1 AND m.visibility='published' AND m.price_cents>0 AND m.owner_id<>$1 AND NOT EXISTS (SELECT 1 FROM purchases WHERE user_id=$1 AND media_id=m.id) ORDER BY m.id LIMIT 100",[u.id])).rows;
  if(!items.length)return reply.code(400).send({error:"Cart empty"});
  const orderId=randomUUID();const sum=items.reduce((n,m)=>n+m.price_cents,0);
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   await client.query("INSERT INTO orders(id,user_id,amount_cents) VALUES($1,$2,$3)",[orderId,u.id,sum]);
   for(const m of items)await client.query("INSERT INTO order_items(order_id,media_id,unit_amount_cents) VALUES($1,$2,$3)",[orderId,m.id,m.price_cents]);
   await client.query("COMMIT");
  } catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  const s=await stripe().checkout.sessions.create({
   mode:"payment",success_url:process.env.PUBLIC_APP_URL+"/library?checkout=success",
   cancel_url:process.env.PUBLIC_APP_URL+"/cart?checkout=cancel",customer_email:u.email,
   line_items:items.map(m=>({price_data:{currency:"usd",unit_amount:m.price_cents,product_data:{name:m.title}},quantity:1})),
   metadata:{orderId,userId:u.id}
  });
  await query("UPDATE orders SET stripe_session_id=$2 WHERE id=$1",[orderId,s.id]);
  return {url:s.url};
 });
 // The ONLY mechanism for granting paid entitlements is a verified Stripe webhook.
 app.post("/api/stripe/webhook",{config:{rawBody:true}},async(req,reply)=>{
  if(!process.env.STRIPE_WEBHOOK_SECRET)return reply.code(503).send({error:"Webhook not configured"});
  const sig=req.headers["stripe-signature"];
  if(typeof sig!=="string")return reply.code(400).send({error:"Signature missing"});
  let event:Stripe.Event;
  try{
   const raw=(req as unknown as {rawBody?:Buffer}).rawBody;
   if(!raw)return reply.code(400).send({error:"Raw body missing"});
   event=stripe().webhooks.constructEvent(raw,sig,process.env.STRIPE_WEBHOOK_SECRET);
  }catch{return reply.code(400).send({error:"Invalid webhook signature"});}
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   const inserted=await client.query("INSERT INTO stripe_events(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id",[event.id]);
   if(!inserted.rowCount){await client.query("COMMIT");return {received:true,duplicate:true};}
   if(event.type==="checkout.session.completed"){
    const s=event.data.object as Stripe.Checkout.Session;
    if(s.mode==="payment" && s.payment_status==="paid" && s.metadata?.orderId){
     const result=await client.query("UPDATE orders SET status='paid' WHERE id=$1 AND user_id=$2 AND stripe_session_id=$3 AND status='pending' AND amount_cents=$4 RETURNING id,user_id",[s.metadata.orderId,s.metadata.userId,s.id,s.amount_total]);
     if(result.rowCount){
      await client.query("INSERT INTO purchases(user_id,media_id,order_id) SELECT o.user_id,i.media_id,o.id FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=$1 ON CONFLICT(user_id,media_id) DO NOTHING",[s.metadata.orderId]);
      await client.query("DELETE FROM carts WHERE user_id=$1 AND media_id IN (SELECT media_id FROM order_items WHERE order_id=$2)",[s.metadata.userId,s.metadata.orderId]);
     }
    }
   }
   if(event.type==="customer.subscription.created" || event.type==="customer.subscription.updated" || event.type==="customer.subscription.deleted"){
    const s=event.data.object as Stripe.Subscription;
    const {userId,planId,internalId}=s.metadata||{};
    if(userId && planId && internalId){
     const status=s.status;
     await client.query("UPDATE subscriptions SET stripe_subscription_id=$4,stripe_customer_id=$5,status=$6 WHERE id=$1 AND user_id=$2 AND plan_id=$3",[internalId,userId,planId,s.id,typeof s.customer==="string"?s.customer:s.customer.id,status]);
    }else{
     await client.query("UPDATE subscriptions SET status=$2 WHERE stripe_subscription_id=$1",[s.id,s.status]);
    }
   }
   await client.query("COMMIT");
   return {received:true};
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 });
}
