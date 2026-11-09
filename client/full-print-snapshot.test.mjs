import test from "node:test";
import assert from "node:assert/strict";
import {captureWinterFullPrintSnapshot,makeWinterFullPrintEmailPayload} from "./full-print-snapshot.mjs";

function mockWindow({example=false}={}){
  const input={
    "plan-park":{value:"zion"},"plan-month":{value:"jan"},
    "trip-days":{value:"4"},"fridge-watts":{value:"18"},
    recharge:{value:"3"},"winter-recharge-method":{value:"none"},
    basic:{checked:true},fridge:{checked:true},
    "winter-source-confirmed":{checked:false},"portable-away":{checked:false},
    "print-example-note":{hidden:!example},
    "print-plan":{outerHTML:'<section id="print-plan"><h1>Zion</h1><h2>Access &amp; stay notes</h2><p>Road status</p><h2>Your packing checklist</h2><li>Water</li><h2>Recommended products &amp; booking links</h2><p>Affiliate disclosure: partner offers</p></section>'}
  };
  let printed=0;
  const document={
    getElementById:id=>input[id]??null,
    querySelector:sel=>sel==='input[name="stay"]:checked'?{value:"dispersed"}:null,
    querySelectorAll:sel=>{
      if(sel==="style")return [{textContent:"@media print { @page { size:A4 } #print-plan{display:block} }"}];
      if(sel==="#print-itinerary a[href]")return [{href:"https://www.nps.gov/zion/planyourvisit/conditions.htm"}];
      if(sel==="[data-pack]:checked")return [{dataset:{pack:"warm-layers"}}];
      return [];
    }
  };
  return {document,Event:class {constructor(type){this.type=type;}},dispatchEvent:e=>{if(e.type==="beforeprint")printed++;},get printEvents(){return printed;}};
}
test("captures the existing full print DOM and CSS, never a reduced summary",()=>{
  const win=mockWindow(),snapshot=captureWinterFullPrintSnapshot(win);
  assert.equal(win.printEvents,1);
  assert.equal(snapshot.version,"winter-full-print-v12.5");
  assert.match(snapshot.markup,/Affiliate disclosure/);
  assert.match(snapshot.markup,/Recommended products/);
  assert.match(snapshot.markup,/Your packing checklist/);
  assert.match(snapshot.css,/@media print/);
});
test("does not email an example-only non-customized plan",()=>{
  assert.throws(()=>captureWinterFullPrintSnapshot(mockWindow({example:true})),/Customize your trip/);
});
test("payload preserves the canonical print DOM and normalized planner state",()=>{
  const win=mockWindow(),payload=makeWinterFullPrintEmailPayload({email:"controlled@example.com",turnstileToken:"test-token",win});
  assert.equal(payload.plan.park,"zion");
  assert.equal(payload.plan.stay,"dispersed");
  assert.deepEqual(payload.plan.load,["phones","fridge"]);
  assert.equal(payload.plan.days,4);
  assert.equal(payload.plan.recharge,"3");
  assert.equal(payload.plan.fridgeW,18);
  assert.equal(payload.plan.method,"none");
  assert.equal(payload.npsUrl,"https://www.nps.gov/zion/planyourvisit/conditions.htm");
  assert.deepEqual(payload.plan.unchecked,["warm-layers"]);
  assert.match(payload.printSnapshot.markup,/Affiliate disclosure/);
});
