(()=>{var{defineProperty:XZ,getOwnPropertyNames:X1,getOwnPropertyDescriptor:B1}=Object,Q1=Object.prototype.hasOwnProperty;var G0=new WeakMap,h4=(Z)=>{var $=G0.get(Z),J;if($)return $;if($=XZ({},"__esModule",{value:!0}),Z&&typeof Z==="object"||typeof Z==="function")X1(Z).map((Y)=>!Q1.call($,Y)&&XZ($,Y,{get:()=>Z[Y],enumerable:!(J=B1(Z,Y))||J.enumerable}));return G0.set(Z,$),$};var q4=(Z,$)=>{for(var J in $)XZ(Z,J,{get:$[J],enumerable:!0,configurable:!0,set:(Y)=>$[J]=()=>Y})};class QZ extends Error{database;constructor(Z,$){super("The storage connection closed before its transaction began.",{cause:$});this.database=Z}}class x{factory;name;legacyTable;connection;connectedDatabase;constructor(Z,$,J){this.factory=Z;this.name=$;this.legacyTable=J}async close(){let Z=this.connection;if(this.connection=void 0,this.connectedDatabase=void 0,Z)(await Z).close()}async apply(Z,$,J){let Y=await this.lookupId(Z);for(let G=0;;G++)try{let H=await this.database();for(let W=0;W<128;W++){let D=await this.snapshot(H,Y),V=D.record?await this.decrypt(D.record,D.key,Z):$(),B=J(V);if(!B.changed)return B.result;let F=await this.encrypt(Y,D.key,B.value);if(await this.compareAndSwap(H,Y,D,F))return B.result}throw Error("Storage is busy in another tab. Keep this tab open and retry.")}catch(H){if(!(H instanceof QZ))throw H;if(this.forgetConnection(H.database),H.database.close(),G>=1)throw H.cause}}forgetConnection(Z){if(this.connectedDatabase!==Z)return;this.connection=void 0,this.connectedDatabase=void 0}database(){if(!this.connection){let Z=this.open().then(async($)=>{if(this.connection===Z)this.connectedDatabase=$;$.onclose=()=>this.forgetConnection($),$.onversionchange=()=>{this.forgetConnection($),$.close()};try{return await this.initializeKey($),await this.migrate($),$}catch(J){throw $.close(),J}});this.connection=Z,Z.catch(()=>{if(this.connection===Z)this.connection=void 0,this.connectedDatabase=void 0})}return this.connection}open(){return new Promise((Z,$)=>{let J=this.factory.open(this.name,2),Y=!1,G=(H)=>{Y=!0,$(H)};J.onupgradeneeded=()=>{let H=J.result;if(!H.objectStoreNames.contains(this.legacyTable))H.createObjectStore(this.legacyTable,{keyPath:"key"});if(!H.objectStoreNames.contains("encrypted-records"))H.createObjectStore("encrypted-records",{keyPath:"id"});if(!H.objectStoreNames.contains("encryption-keys"))H.createObjectStore("encryption-keys",{keyPath:"id"})},J.onerror=()=>G(J.error??Error("Could not open encrypted storage")),J.onblocked=()=>G(Error("Storage is busy; close older extension pages and retry")),J.onsuccess=()=>{let H=J.result;if(Y){H.close();return}Z(H)}})}async initializeKey(Z){let $=await f(Z,["encryption-keys","encrypted-records"],"readonly",(G,H)=>{let W=G.objectStore("encryption-keys").get("record-key");W.onsuccess=()=>H(W.result)});if($){a($);return}let J=await crypto.subtle.generateKey({name:"AES-GCM",length:256},!1,["encrypt","decrypt"]),Y={id:"record-key",token:crypto.randomUUID(),key:J};await f(Z,["encryption-keys","encrypted-records"],"readwrite",(G,H,W)=>{let D=G.objectStore("encryption-keys").get("record-key");D.onsuccess=()=>{try{if(D.result){a(D.result),H();return}let V=G.objectStore("encrypted-records").count();V.onsuccess=()=>{try{if(V.result!==0){W(Error("The encryption key is missing. Existing data has been preserved; do not reset extension storage."));return}G.objectStore("encryption-keys").add(Y),H()}catch(B){W(B)}}}catch(V){W(V)}}})}async lookupId(Z){let $=await crypto.subtle.digest("SHA-256",BZ(JSON.stringify([this.name,this.legacyTable,Z])));return Array.from(new Uint8Array($),(J)=>J.toString(16).padStart(2,"0")).join("")}authenticatedData(Z,$){return BZ(JSON.stringify([1,this.name,this.legacyTable,Z,$]))}async encrypt(Z,$,J){let Y=crypto.getRandomValues(new Uint8Array(12)),G=await crypto.subtle.encrypt({name:"AES-GCM",iv:Y,additionalData:this.authenticatedData(Z,$.token)},$.key,BZ(JSON.stringify(J)));return{id:Z,format:1,keyToken:$.token,iv:Y,ciphertext:G}}async decrypt(Z,$,J){try{if(Z.format!==1||Z.keyToken!==$.token||!(Z.iv instanceof Uint8Array)||Z.iv.byteLength!==12||!(Z.ciphertext instanceof ArrayBuffer))throw Error();let Y=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(Z.iv),additionalData:this.authenticatedData(Z.id,$.token)},$.key,Z.ciphertext),G=JSON.parse(new TextDecoder("utf-8",{fatal:!0}).decode(Y));if(!G||G.key!==J)throw Error();return G}catch{throw Error("Stored data could not be decrypted or verified. It has been preserved; do not reset extension storage.")}}snapshot(Z,$,J){let Y=["encryption-keys","encrypted-records",...J===void 0?[]:[this.legacyTable]];return f(Z,Y,"readonly",(G,H,W)=>{let D=G.objectStore("encryption-keys").get("record-key"),V=G.objectStore("encrypted-records").get($),B=J===void 0?void 0:G.objectStore(this.legacyTable).get(J),F=B??V;F.onsuccess=()=>{try{a(D.result),H({key:D.result,record:V.result,legacy:B?.result})}catch(Q){W(Q)}}})}compareAndSwap(Z,$,J,Y,G,H=!1){let W=["encryption-keys","encrypted-records",...G===void 0?[]:[this.legacyTable]];return f(Z,W,"readwrite",(D,V,B)=>{let F=D.objectStore("encryption-keys").get("record-key"),Q=D.objectStore("encrypted-records").get($),K=G===void 0?void 0:D.objectStore(this.legacyTable).get(G);(K??Q).onsuccess=()=>{try{if(a(F.result),F.result.token!==J.key.token)throw Error("The encryption key changed. Keep this tab open and retry.");if(!F1(Q.result,J.record)||K&&JSON.stringify(K.result)!==JSON.stringify(J.legacy)){V(!1);return}if(Y)D.objectStore("encrypted-records").put(Y);if(H)D.objectStore(this.legacyTable).delete(G);V(!0)}catch(U){B(U)}}})}async migrate(Z){for(;;){let $=await f(Z,[this.legacyTable],"readonly",(G,H)=>{let W=G.objectStore(this.legacyTable).openKeyCursor();W.onsuccess=()=>H(W.result?.key)});if($===void 0)return;if(typeof $!=="string")throw Error("Legacy storage could not be verified. Its original data has been preserved.");let J=await this.lookupId($),Y=!1;for(let G=0;G<128;G++){let H=await this.snapshot(Z,J,$);if(H.legacy===void 0){Y=!0;break}let W=H.legacy;if(!W||W.key!==$)throw Error("Legacy storage could not be verified. Its original data has been preserved.");if(H.record){let D=await this.decrypt(H.record,H.key,$);if(JSON.stringify(D)!==JSON.stringify(W))throw Error("Legacy and encrypted records differ. Both copies have been preserved.");if(await this.compareAndSwap(Z,J,H,void 0,$,!0)){Y=!0;break}}else{let D=await this.encrypt(J,H.key,W);await this.compareAndSwap(Z,J,H,D,$)}}if(!Y)throw Error("Storage migration is busy. Original data is preserved; retry.")}}}function BZ(Z){return new TextEncoder().encode(Z)}function a(Z){if(!Z||Z.id!=="record-key"||typeof Z.token!=="string"||!Z.token||!Z.key||Z.key.type!=="secret"||Z.key.extractable||Z.key.algorithm?.name!=="AES-GCM"||Z.key.algorithm.length!==256||!Array.isArray(Z.key.usages)||!Z.key.usages.includes("encrypt")||!Z.key.usages.includes("decrypt"))throw Error("The encryption key is missing or invalid. Existing data has been preserved; do not reset extension storage.")}function F1(Z,$){if(!Z||!$)return Z===$;return Z.id===$.id&&Z.format===$.format&&Z.keyToken===$.keyToken&&H0(Z.iv,$.iv)&&H0(Z.ciphertext,$.ciphertext)}function H0(Z,$){let J=new Uint8Array(Z instanceof Uint8Array?Z.buffer.slice(Z.byteOffset,Z.byteOffset+Z.byteLength):Z),Y=new Uint8Array($ instanceof Uint8Array?$.buffer.slice($.byteOffset,$.byteOffset+$.byteLength):$);return J.length===Y.length&&J.every((G,H)=>G===Y[H])}function f(Z,$,J,Y){return new Promise((G,H)=>{let W;try{W=Z.transaction($,J,{durability:"strict"})}catch(Q){H(Q&&typeof Q==="object"&&"name"in Q&&Q.name==="InvalidStateError"?new QZ(Z,Q):Q);return}let D,V=!1,B,F=(Q)=>{B=Q,W.abort()};W.oncomplete=()=>V?G(D):H(Error("Storage returned no result")),W.onabort=()=>H(B??W.error??Error("Storage transaction failed. Keep this tab open and retry.")),W.onerror=()=>{B??=W.error};try{Y(W,(Q)=>{D=Q,V=!0},F)}catch(Q){F(Q)}})}var K1="plannotator:queue",x4="plannotator:queue:changed",V0=1e4,FZ=30000,D0=30000,P1=3000,W0=200000,KZ=100;function v(Z){try{let $=new URL(Z);if($.username||$.password)return null;if($.protocol==="https:"&&$.hostname==="chatgpt.com"){let J=$.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)(?:\/|$)/);return J?`chatgpt:${J[1]}`:null}if($.origin==="https://claude.ai"){let J=$.pathname.match(/^\/chat\/([A-Za-z0-9_-]{1,128})\/?$/);return J?`claude:${J[1]}`:null}if($.origin==="https://gemini.google.com"){let J=$.pathname.match(/^\/app\/([A-Za-z0-9_-]{1,128})\/?$/);return J?`gemini:${J[1]}`:null}if($.protocol==="http:"&&["localhost","127.0.0.1"].includes($.hostname))return`fixture:${$.origin}${$.pathname}`}catch{}return null}class C1{storage;constructor(Z=indexedDB,$="plannotator-message-queue-v1"){this.storage=new x(Z,$,"queues")}close(){return this.storage.close()}async apply(Z,$,J=Date.now()){if(O1(Z),!$||$.length>256)throw Error("Invalid queue client");return this.storage.apply(Z.key,()=>({key:Z.key,revision:0,paused:!1,items:[],busyLeases:[]}),(Y)=>{let G=JSON.stringify(Y);U1(Y,J);let H=R1(Y,Z,$,J),W=JSON.stringify(Y)!==G;if(W)Y.revision+=1;let{retiredIds:D,editReceipts:V,busyLeases:B,legacyBusyUntil:F,...Q}=Y,K={state:structuredClone(Q),changed:W,...H?{claimed:structuredClone(H)}:{}};return{value:Y,result:K,changed:W}})}}function O1(Z){if(!Z||Z.type!==K1||typeof Z.key!=="string"||Z.key.length>2048||!/^(chatgpt|claude|gemini|fixture):/.test(Z.key))throw Error("Invalid queue conversation");if(typeof Z.clientId!=="string"||!/^[A-Za-z0-9:_-]{1,128}$/.test(Z.clientId))throw Error("Invalid queue client");if(!["read","enqueue","begin-edit","edit-heartbeat","cancel-edit","steer","edit","move","remove","pause","heartbeat","claim","attempt","ack","anchor","complete","release","review","retry"].includes(Z.action))throw Error("Unknown queue action");if(Z.id!==void 0&&(typeof Z.id!=="string"||!/^[A-Za-z0-9:_-]{1,128}$/.test(Z.id)))throw Error("Invalid queued message ID");if(Z.editToken!==void 0&&(typeof Z.editToken!=="string"||!/^[A-Za-z0-9:_-]{1,128}$/.test(Z.editToken)))throw Error("Invalid queue edit token");if(["begin-edit","edit-heartbeat","cancel-edit"].includes(Z.action)&&!Z.editToken)throw Error("Missing queue edit token");if(Z.afterUserMessageId!==void 0&&(typeof Z.afterUserMessageId!=="string"||!Z.afterUserMessageId||Z.afterUserMessageId.length>256))throw Error("Invalid queue transcript anchor");if(["enqueue","edit"].includes(Z.action)&&(typeof Z.text!=="string"||!Z.text.trim()||Z.text.length>W0))throw Error(`Queued messages must contain 1–${W0.toLocaleString()} characters`)}function U1(Z,$){for(let J of Z.items){if(J.status==="editing"&&(J.leaseUntil??0)<=$)k(J),Z.paused=!0;if(J.status==="claimed"&&(J.leaseUntil??0)<=$)k(J);if(J.status==="sending"&&(J.attemptedAt??0)+D0<=$)J.status="review",J.reason="Delivery could not be confirmed. Check the chat before retrying to avoid a duplicate.",delete J.leaseUntil}X0(Z,$)}function X0(Z,$){if(!Z.busyLeases){if((Z.busyUntil??0)>$)Z.legacyBusyUntil=Math.max(Z.legacyBusyUntil??0,Z.busyUntil);Z.busyLeases=[]}if(Z.busyLeases=Z.busyLeases.filter((Y)=>Y.until>$),(Z.legacyBusyUntil??0)<=$)delete Z.legacyBusyUntil;let J=Z.busyLeases.reduce((Y,G)=>Math.max(Y,G.until),Z.legacyBusyUntil??0);if(J>$)Z.busyUntil=J;else delete Z.busyUntil}function R1(Z,$,J,Y){let G=Z.items.find((V)=>V.id===$.id),H=()=>{if(!G)throw Error("This queued message is no longer available");return G},W=(V)=>{let B=H();if(B.status!==V||B.owner!==J)throw Error("This queued message is being handled by another tab or has changed");return B},D=()=>{let V=W("editing");if(V.editToken!==$.editToken)throw Error("This edit session has changed; reopen the queued message");return V};switch($.action){case"read":return;case"heartbeat":{if($.busy===!0||$.busy===!1){let V=Z.busyLeases.find((B)=>B.owner===J);if(Z.busyLeases=Z.busyLeases.filter((B)=>B.owner!==J),$.busy)Z.busyLeases.push({owner:J,until:Math.max(V?.until??0,Y+P1)});X0(Z,Y)}return}case"enqueue":if(!$.id)throw Error("Missing queued message ID");if(G||Z.retiredIds?.includes($.id))return;if(Z.items.length>=KZ)throw Error(`Queue is full (${KZ} messages)`);if(Z.items.length===0)if($.afterUserMessageId)Z.lastCompletedUserMessageId=$.afterUserMessageId;else delete Z.lastCompletedUserMessageId;Z.items.push({id:$.id,text:$.text,createdAt:Y,status:"queued"});return;case"pause":if(typeof $.paused!=="boolean")throw Error("Invalid queue pause state");if(Z.paused=$.paused,Z.paused){for(let V of Z.items)if(V.status==="claimed")k(V)}return;case"begin-edit":{let V=H();if(V.status==="editing"&&V.owner===J&&V.editToken===$.editToken){V.leaseUntil=Y+FZ;return}if(V.status!=="queued")throw Error("Only queued messages can be edited");V.status="editing",V.owner=J,V.editToken=$.editToken,V.leaseUntil=Y+FZ;return}case"edit-heartbeat":{D().leaseUntil=Y+FZ;return}case"cancel-edit":{k(D());return}case"edit":{if(!G&&$.editToken&&Z.editReceipts?.some((B)=>B.id===$.id&&B.editToken===$.editToken&&B.text===$.text))return;let V=H();if(V.status!=="editing"&&$.editToken&&V.lastEditToken===$.editToken&&V.text===$.text)return;if(V.status==="editing"){D(),V.text=$.text,V.lastEditToken=$.editToken,k(V);return}if(V.status!=="queued")throw Error("Only queued messages can be edited");if($.editToken)throw Error("This edit session has expired or changed; reopen the queued message");V.text=$.text,delete V.lastEditToken;return}case"move":{let V=H();if(V.status!=="queued")throw Error("Only queued messages can be reordered");if(!Number.isInteger($.delta)||!$.delta||Math.abs($.delta)>KZ)throw Error("Invalid queue move");let B=Z.items.indexOf(V),F=Math.max(0,Math.min(Z.items.length-1,B+$.delta));if(Z.items.slice(Math.min(B,F),Math.max(B,F)+1).some((Q)=>Q.status!=="queued"))throw Error("Cannot move past a message that is already being sent");Z.items.splice(B,1),Z.items.splice(F,0,V);return}case"remove":{if(!G)return;if(G.status==="editing"){if(G.owner!==J)throw Error("Another tab is editing this queued message")}else if(!["queued","review"].includes(G.status))throw Error("Wait for this message's delivery status before removing it");PZ(Z,G);return}case"claim":{if(Z.lastCompletedUserMessageId&&$.afterUserMessageId!==Z.lastCompletedUserMessageId)return;if(Z.paused||(Z.busyUntil??0)>Y||Z.items.some((B)=>B.status!=="queued"))return;let V=Z.items[0];if(!V)return;return V.status="claimed",V.owner=J,V.leaseUntil=Y+V0,V}case"steer":{let V=H();if(V.status!=="queued"||Z.items.some((F)=>!["queued","waiting"].includes(F.status)))throw Error("Wait for the active send or edit to finish before sending this message now");Z.items.splice(Z.items.indexOf(V),1);let B=Z.items.reduce((F,Q,K)=>Q.status==="waiting"?K:F,-1);return Z.items.splice(B+1,0,V),V.status="claimed",V.owner=J,V.leaseUntil=Y+V0,V.sendNow=!0,V}case"attempt":{let V=W("claimed");if(V.sendNow){for(let B of Z.items.filter((F)=>F.status==="waiting"))PZ(Z,B);delete Z.lastCompletedUserMessageId}else if(Z.paused||(Z.busyUntil??0)>Y)throw Error("ChatGPT became busy or the queue was paused");V.status="sending",V.attemptedAt=Y,V.leaseUntil=Y+D0;return}case"ack":{let V=H();if(V.owner!==J||!["sending","review","waiting"].includes(V.status))throw Error("This message's delivery cannot be acknowledged by this tab");if(typeof $.userMessageId!=="string"||!$.userMessageId||$.userMessageId.length>256)throw Error("Missing confirmed ChatGPT message ID");if(V.status==="waiting"&&V.userMessageId!==$.userMessageId)throw Error("Conflicting ChatGPT message ID");V.status="waiting",V.userMessageId=$.userMessageId,delete V.leaseUntil,delete V.reason;return}case"anchor":{if(!$.key.startsWith("gemini:")||typeof $.userMessageId!=="string"||!/^gemini:user:user-query-content-\d+:[a-z0-9]+$/.test($.userMessageId??"")||!/^gemini:user:[0-9a-f]{16}$/i.test($.afterUserMessageId??""))throw Error("Invalid Gemini transcript anchor promotion");if($.id){if(G?.status==="waiting"&&G.userMessageId===$.userMessageId)G.userMessageId=$.afterUserMessageId}else if(Z.lastCompletedUserMessageId===$.userMessageId)Z.lastCompletedUserMessageId=$.afterUserMessageId;return}case"complete":{if(!G)return;if(G.status!=="waiting")throw Error("Delivery must be confirmed before completing a queued message");if($.userMessageId!==void 0&&$.userMessageId!==G.userMessageId)throw Error("ChatGPT message ID does not match");Z.lastCompletedUserMessageId=G.userMessageId,PZ(Z,G);return}case"release":{if(!G)return;k(W("claimed"));return}case"review":{let V=H();if(V.owner!==J)throw Error("This send attempt belongs to another tab or has changed");if(V.status==="waiting")return;if(!["sending","review"].includes(V.status))throw Error("This message has not been sent yet");V.status="review",V.reason=typeof $.reason==="string"?$.reason.slice(0,1000):"Check whether this message was delivered before retrying.",delete V.leaseUntil;return}case"retry":{let V=H();if(V.status!=="review")throw Error("Only messages needing review can be retried");k(V);return}}}function k(Z){Z.status="queued",delete Z.owner,delete Z.leaseUntil,delete Z.attemptedAt,delete Z.userMessageId,delete Z.reason,delete Z.editToken,delete Z.sendNow}function PZ(Z,$){if($.lastEditToken)Z.editReceipts=[...Z.editReceipts??[],{id:$.id,editToken:$.lastEditToken,text:$.text}].slice(-20);Z.items.splice(Z.items.indexOf($),1),Z.retiredIds=[...Z.retiredIds??[],$.id].slice(-1000)}function C(){return window.location.hostname==="claude.ai"?"claude":window.location.hostname==="gemini.google.com"?"gemini":"chatgpt"}var F0={claude:["[data-cds='ChatComposer'] [data-testid='chat-input'][contenteditable='true']","[data-testid='chat-input'][contenteditable='true'][role='textbox']"],gemini:["input-area-v2 rich-textarea .ql-editor[contenteditable='true'][role='textbox']"]},K0="[data-cds='ChatComposer'], input-area-v2",P0="[data-testid='assistant-message'] :is([data-perf-reply-text], .standard-markdown)",C0="model-response message-content .markdown";function CZ(){return Array.from(document.querySelectorAll(C()==="claude"?P0:C0))}function B0(Z){let $=2166136261;for(let J=0;J<Z.length;J++)$=Math.imul($^Z.charCodeAt(J),16777619);return($>>>0).toString(36)}function OZ(Z,$){if(C()==="claude"){let G=Z.closest("[data-testid='transcript-row']"),H=G?.getAttribute("data-index"),W=G?.getAttribute("data-perf-row");if(!H||!/^\d+$/.test(H)||!["human","assistant"].includes(W??""))return null;return`claude:${W}:${H}:${B0($.replace(/\s+/g," ").trim())}`}let J=Z.closest("user-query");if(J){let G=J.querySelector(".query-content[id^='user-query-content-']");if(!G)return null;let H=G.id.match(/^user-query-content-(\d+)$/)?.[1];if(!H){let W=Array.from(document.querySelectorAll("user-query .query-content[id]")),D=W.indexOf(G);for(let V=D-1;V>=0;V--){let B=W[V].id.match(/^user-query-content-(\d+)$/)?.[1];if(B){H=String(Number(B)+D-V);break}}if(!H&&D===0&&W.length===1)H="0"}if(H===void 0)return null;return`gemini:user:user-query-content-${H}:${B0($.replace(/\s+/g," ").trim())}`}let Y=Z.closest(".conversation-container[id]");if(!Y?.id)return null;return`gemini:assistant:${Y.id}`}function _1(Z,$){let J=Array.from(Z.querySelectorAll(".query-text-line"));if(!J.length)return $(Z).replace(/\u00a0/g," ").trim();return J.map((Y)=>{if(Y.children.length===1&&Y.firstElementChild?.tagName==="BR"&&!Y.textContent)return"";let G=$(Y);return G.length>=2&&G.startsWith(" ")&&G.endsWith(" ")?G.slice(1,-1):G}).join(`
`).replace(/\u00a0/g," ")}function O0(Z,$,J){let Y=C(),G=Y==="claude"?"[data-testid='user-message']":"user-query .query-text",H=Y==="claude"?P0:C0,W=J==="user"?G:J==="assistant"?H:`${G}, ${H}`,D=[];for(let V of Array.from(document.querySelectorAll(W))){if(!Z(V))continue;let B=V.matches("[data-testid='user-message'], .query-text")?"user":"assistant",F=V.cloneNode(!0);F.querySelectorAll("button, [role='button'], script, style, .cdk-visually-hidden, .sr-only").forEach((U)=>U.remove());let Q=Y==="gemini"&&B==="user"?_1(F,$):$(F).replace(/\u00a0/g," ").trim(),K=OZ(V,Q);if(K&&Q.trim()&&!D.some((U)=>U.id===K))D.push({id:K,text:Q,role:B,element:V})}return D}function U0(Z){let $=C()==="claude"?"[data-testid='transcript-row'][data-perf-row-streaming='true'], [data-testid='assistant-message'][data-is-streaming='true'], [aria-label='Currently streaming message']":"model-response [aria-busy='true']";return Array.from(document.querySelectorAll($)).some(Z)}var Q0=new WeakMap;function R0(Z,$){if(C()==="gemini"){let G=Z.slice(7),H=[];for(let W of Array.from(document.querySelectorAll("model-response [jslog]"))){let D=W.getAttribute("jslog")?.match(/BardVeMetadataKey:([^;]+)/)?.[1];if(!D)continue;try{let V=JSON.parse(atob(D)),B=Array.isArray(V)&&Array.isArray(V[0])?V[0][1]:null;if(typeof B==="string"&&B.startsWith("c_"))H.push(B.slice(2))}catch{}}return H.length>0&&H.every((W)=>W===G)}let J=$.filter((G)=>G.role==="user").map((G)=>G.id).join("|"),Y=Q0.get(document);if(!Y)Y={key:Z,signature:J,stale:null},Q0.set(document,Y);else if(Y.key!==Z)Y.stale=Y.signature,Y.key=Z;if(Y.stale!==null){if(!J||J===Y.stale)return!1;Y.stale=null}return Y.signature=J,Array.from(document.querySelectorAll("a[aria-current='page'][href]")).some((G)=>{try{return new URL(G.href).pathname===window.location.pathname}catch{return!1}})}function _0(Z,$){let J=C(),Y=Z.element.closest(J==="claude"?"[data-testid='transcript-row']":"model-response");if(!Y)return!1;if(J==="claude"&&(Y.getAttribute("data-perf-row-streaming")!=="false"||Z.element.closest("[data-testid='assistant-message']")?.getAttribute("data-is-streaming")!=="false"))return!1;if(J==="gemini"&&(Z.element.getAttribute("aria-busy")!=="false"||!Y.querySelector(".response-footer.complete")))return!1;let G=Array.from(Y.querySelectorAll("button")).filter($).filter((H)=>!Z.element.contains(H)).map((H)=>H.getAttribute("aria-label")?.toLowerCase());return G.includes("copy")&&G.includes("good response")&&G.includes("bad response")}var L1=["[data-composer-input] [data-composer-markdown][contenteditable='true']","[data-composer-markdown][contenteditable='true'][role='textbox']","#prompt-textarea","[data-testid='prompt-textarea']","form[data-type='unified-composer'] textarea","form.group\\/composer textarea","form[data-type='unified-composer'] [contenteditable='true']","form.group\\/composer [contenteditable='true']"],UZ="[data-message-author-role='user'], [data-markdown-text-style='user-message'], [data-chatgpt-search-unit-key$=':user']",o="[data-message-author-role='assistant'], [data-markdown-text-style='assistant-message']",z1=`${UZ}, ${o}`,N1=/^(?:stop|pause)(?:$|[\s…])/i,L0=/^(?:send|send message|send prompt)$/i,z0=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,z=null;function R(Z){if(!(Z instanceof HTMLElement)||!Z.isConnected)return!1;for(let $=Z;$;$=$.parentElement){if($.hidden||$.getAttribute("aria-hidden")==="true")return!1;let J=window.getComputedStyle($);if(J.display==="none"||J.visibility==="hidden"||J.visibility==="collapse")return!1}return Z.getClientRects().length>0}function r(){let Z=C();for(let $ of Z==="chatgpt"?L1:F0[Z])for(let J of Array.from(document.querySelectorAll($))){if(!R(J)||J.closest("[data-plannotator-queue-root], #plannotator-chatgpt-root"))continue;if(J instanceof HTMLTextAreaElement){if(!J.disabled&&!J.readOnly)return J}else if(J.getAttribute("contenteditable")==="true"&&J.getAttribute("aria-disabled")!=="true")return J}return null}function n(Z=r()){if(!Z)return null;let $=Z.closest(`[data-composer-body], form, [data-composer-surface], section[aria-label*='composer' i], ${K0}`);if($)return $;let J=Z.parentElement;for(let Y=0;J&&Y<6;Y++,J=J.parentElement){if(J===document.body||J.matches("main, [role='main']"))break;if(Array.from(J.querySelectorAll("button")).some((G)=>N0(G)||s(G)))return J}return Z.parentElement}function s(Z){return Z.getAttribute("data-testid")==="stop-button"||N1.test((Z.getAttribute("aria-label")||Z.getAttribute("title")||"").trim())}function N0(Z){if(s(Z))return!1;let $=(Z.getAttribute("aria-label")||Z.getAttribute("title")||"").trim();if($&&!L0.test($))return!1;return Z.getAttribute("data-testid")==="send-button"||Z.id==="composer-submit-button"||L0.test($)}function M1(){let Z=n();if(!Z)return null;for(let $ of Array.from(Z.querySelectorAll("button")))if(R($)&&N0($)&&!$.disabled&&$.getAttribute("aria-disabled")!=="true")return $;return null}function c4(){let Z=(Y)=>{if(!R(Y)||Y.disabled||Y.getAttribute("aria-disabled")==="true"||!s(Y))return!1;let G=`${Y.getAttribute("aria-label")??""} ${Y.getAttribute("title")??""}`;return!/\b(?:audio|playback|recording|dictation|voice|music|read[ -]?aloud)\b/i.test(G)&&!Y.closest("[data-testid*='audio'], [data-testid*='voice'], [aria-label*='read aloud' i]")},$=n(),J=$&&Array.from($.querySelectorAll("button")).find(Z);if(J)return J;return Array.from(document.querySelectorAll("button[data-testid='stop-button']")).find(Z)??null}function _Z(Z){if(Z instanceof HTMLTextAreaElement)return Z.value;return g(Z).replace(/\u00a0/g," ")}function g(Z){let $="";for(let J of Array.from(Z.childNodes)){if(J.nodeType===3){$+=J.textContent??"";continue}if(!(J instanceof HTMLElement))continue;if(J.tagName==="BR"){$+=`
`;continue}let Y=/^(?:P|DIV|LI|PRE|BLOCKQUOTE|H[1-6])$/.test(J.tagName);if(Y&&$&&!$.endsWith(`
`))$+=`
`;if($+=g(J),Y&&J.nextSibling&&!$.endsWith(`
`))$+=`
`}return $}function M0(Z,$){if(!Z.isConnected)return!1;if(Z instanceof HTMLTextAreaElement){if(Z.disabled||Z.readOnly)return!1;let J=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;if(!J)return!1;J.call(Z,$),Z.dispatchEvent(new Event("input",{bubbles:!0})),Z.dispatchEvent(new Event("change",{bubbles:!0}))}else{if(Z.getAttribute("contenteditable")!=="true"||Z.getAttribute("aria-disabled")==="true")return!1;Z.focus({preventScroll:!0});let J=window.getSelection();if(!J)return!1;let Y=document.createRange();Y.selectNodeContents(Z),J.removeAllRanges(),J.addRange(Y);let G=!1;try{G=document.execCommand("insertText",!1,$)}catch{}if(!G)Z.textContent=$,Z.dispatchEvent(new InputEvent("input",{bubbles:!0,composed:!0,data:$,inputType:"insertText"}))}return RZ(_Z(Z))===RZ($)}function A0(){if(C()!=="chatgpt")return U0(R);if(Array.from(document.querySelectorAll("main [role='status'][aria-busy='true'], [role='main'] [role='status'][aria-busy='true']")).some((Z)=>R(Z)&&!Z.closest("[data-composer-body], form, [data-composer-surface]")))return!0;return Array.from(document.querySelectorAll("main[aria-busy='true'], [role='main'][aria-busy='true'], [data-testid='conversation-loading'], [data-testid='conversation-loading-spinner'], [data-is-streaming='true'], [data-message-author-role='assistant'][aria-busy='true'], [data-markdown-text-style='assistant-message'][aria-busy='true']")).some(R)}function I0(){let Z=n();if(Z&&Array.from(Z.querySelectorAll("button")).some(($)=>R($)&&s($)))return!0;if(Array.from(document.querySelectorAll("button[data-testid='stop-button']")).some(R))return!0;if(Array.from(document.querySelectorAll("[data-markdown-animated]")).some(($)=>R($)&&!$.closest("[data-chatgpt-selection-message-id], [data-message-id]")))return!0;return A0()}function LZ(){let Z=n();if(!Z)return!1;if(Array.from(Z.querySelectorAll("input[type='file']")).some((J)=>(J.files?.length??0)>0))return!0;let $=Z.querySelectorAll("[data-file-id], [data-attachment-id], [data-testid='attachment'], [data-testid*='file-preview'], [data-testid*='attachment-preview'], [data-testid*='image-preview'], [data-test-id*='file-preview'], [data-test-id*='attachment-preview'], uploaded-file, file-preview, img[src^='blob:'], img[src^='data:']");if(Array.from($).some(R))return!0;return Array.from(Z.querySelectorAll("button")).some((J)=>{let Y=`${J.getAttribute("aria-label")??""} ${J.getAttribute("title")??""}`;return R(J)&&/\b(?:remove|delete)\b.*\b(?:attachment|file|image|upload)\b/i.test(Y)})}function k0(Z){let $=Z.closest("[data-chatgpt-selection-message-id], [data-message-id]")||Z.querySelector("[data-chatgpt-selection-message-id], [data-message-id]"),J=$?.getAttribute("data-chatgpt-selection-message-id")||$?.getAttribute("data-message-id");if(J)return J;return Z.closest("[data-chatgpt-search-message-ids]")?.getAttribute("data-chatgpt-search-message-ids")?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]??null}function RZ(Z){return Z.replace(/\r\n/g,`
`).replace(/\u00a0/g," ").trim()}function E0(Z){if(C()!=="chatgpt")return O0(R,g,Z);let $=[],J=new Set,Y=Z==="user"?UZ:Z==="assistant"?o:z1;for(let G of Array.from(document.querySelectorAll(Y))){if(!R(G))continue;let H=k0(G);if(!H||J.has(H))continue;let W=G.matches(UZ)?"user":"assistant",V=(G.querySelector(W==="user"?"[data-user-message-bubble='true'], [data-markdown-text-style='user-message'], [data-chatgpt-selection-message-id], [data-message-author-role='user']":"[data-markdown-text-style='assistant-message']")??G).cloneNode(!0);V.querySelectorAll("button, [role='button'], script, style").forEach((F)=>F.remove());let B=RZ(g(V));if(!B)continue;J.add(H),$.push({id:H,text:B,role:W,element:G})}return $}function A1(){return E0("user").map(({id:Z,text:$})=>({id:Z,text:$}))}function S0(){return Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]")).filter(R).map((Z)=>Z.getAttribute("data-chatgpt-selection-conversation-id"))}function l4(Z,$){if(!Z.startsWith("chatgpt:")||v(window.location.href)!==Z)return!1;if(z&&z.routeKey!==Z)return!1;let J=A1()[0],Y=(W)=>W.replace(/\s+/g," ").trim();if(!J||!z0.test(J.id)||!$.trim()||Y(J.text)!==Y($))return!1;let G=S0(),H=G[0];if(!H?.startsWith("local-chatgpt:")||!z0.test(H.slice(14))||G.some((W)=>W!==H))return!1;if(z&&(z.localId!==H||z.firstUserId!==J.id))return!1;return z={routeKey:Z,localId:H,firstUserId:J.id},!0}function d4(){z=null}function zZ(){let Z=v(window.location.href);if(!Z||!r()||C()==="chatgpt"&&A0())return null;let $=E0();if(!$.length)return null;if(C()!=="chatgpt")return R0(Z,$)?$:null;if(Z.startsWith("chatgpt:")){let J=Z.slice(8),Y=S0();if(!Y.length)return null;if(Y.some((G)=>G!==J)){if(!z||z.routeKey!==Z||Y.some((G)=>G!==z.localId)||!$.some((G)=>G.role==="user"&&G.id===z.firstUserId))return null}}return $}function u4(){return zZ()!==null}function i4(Z){if(C()!=="gemini"||!/^gemini:user:user-query-content-\d+:[a-z0-9]+$/.test(Z))return null;let $=zZ();if(!$)return null;let Y=$.find((G)=>G.role==="user"&&G.id===Z)?.element.closest(".conversation-container[id]");return Y&&/^[0-9a-f]{16}$/i.test(Y.id)?`gemini:user:${Y.id}`:null}function a4(Z){if(I0())return!1;let $=zZ();if(!$)return!1;let J=$.findIndex((H)=>H.role==="user"&&(H.id===Z||C()==="gemini"&&Z===`gemini:user:${H.element.closest(".conversation-container[id]")?.id}`));if(J<0)return!1;let Y;for(let H of $.slice(J+1)){if(H.role==="user")break;Y=H}if(!Y)return!1;if(C()!=="chatgpt")return _0(Y,R);let G=Y.element;for(let H=0;G&&H<8;H++,G=G.parentElement){if(G===document.body||G.matches("main, [role='main']"))break;if($.filter((B)=>G.contains(B.element)).some((B)=>B.role==="user"?B.id!==Z:B.id!==Y.id))break;let D=Array.from(G.querySelectorAll("button")).filter(R);if(D.some((B)=>/^(?:copy-turn-action-button|good-response-turn-action-button|bad-response-turn-action-button)$/.test(B.getAttribute("data-testid")??"")))return!0;let V=D.filter((B)=>!B.closest(o)).map((B)=>(B.getAttribute("aria-label")??"").trim().toLowerCase());if(V.includes("rate response")&&(V.includes("copy")||V.includes("copy response")))return!0}return!1}function NZ(){return C()==="claude"?"Claude":C()==="gemini"?"Gemini":"ChatGPT"}function MZ(Z){let $=Z instanceof HTMLElement?Z:Z?.parentElement;if(!$)return null;if(C()!=="chatgpt")return CZ().find((J)=>J===$||J.contains($))??null;return $.closest("[data-message-author-role='assistant']")??$.closest("[data-markdown-text-style='assistant-message']")}function j0(){if(C()!=="chatgpt")return CZ();return[...new Set(Array.from(document.querySelectorAll(o)).map(MZ).filter((Z)=>Z!==null))]}function T0(Z){if(C()!=="chatgpt")return OZ(Z,g(Z));return k0(Z)}var AZ=[["path",{d:"M5 12h14"}],["path",{d:"m12 5 7 7-7 7"}]];var IZ=[["path",{d:"m5 12 7-7 7 7"}],["path",{d:"M12 19V5"}]];var kZ=[["path",{d:"M20 6 9 17l-5-5"}]];var EZ=[["path",{d:"m6 9 6 6 6-6"}]];var SZ=[["path",{d:"m9 18 6-6-6-6"}]];var jZ=[["circle",{cx:"9",cy:"12",r:"1"}],["circle",{cx:"9",cy:"5",r:"1"}],["circle",{cx:"9",cy:"19",r:"1"}],["circle",{cx:"15",cy:"12",r:"1"}],["circle",{cx:"15",cy:"5",r:"1"}],["circle",{cx:"15",cy:"19",r:"1"}]];var t=[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56"}]];var TZ=[["rect",{x:"14",y:"3",width:"5",height:"18",rx:"1"}],["rect",{x:"5",y:"3",width:"5",height:"18",rx:"1"}]];var wZ=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{d:"m15 5 4 4"}]];var hZ=[["path",{d:"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]];var qZ=[["path",{d:"M5 12h14"}],["path",{d:"M12 5v14"}]];var e=[["path",{d:"M10 11v6"}],["path",{d:"M14 11v6"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{d:"M3 6h18"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]];var I1={"arrow-right":AZ,send:IZ,check:kZ,"chevron-down":EZ,"chevron-right":SZ,grip:jZ,loader:t,pause:TZ,edit:wZ,play:hZ,plus:qZ,trash:e},w0=(Z)=>String(Z).replace(/[&"<>]/g,($)=>({"&":"&amp;",'"':"&quot;","<":"&lt;",">":"&gt;"})[$]);function b(Z,$=16,J=""){let Y=I1[Z].map(([G,H])=>`<${G} ${Object.entries(H).filter(([,W])=>W!==void 0).map(([W,D])=>`${W}="${w0(D)}"`).join(" ")}></${G}>`).join("");return`<svg class="icon icon-${Z}${J?` ${w0(J)}`:""}" xmlns="http://www.w3.org/2000/svg" width="${$}" height="${$}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${Y}</svg>`}var yZ="plannotator:annotations",q0="plannotator:annotations:changed",bZ=500,h0=200000,k1=2000,b0=8000000;function y0(Z){try{let $=new URL(Z);if($.hostname==="chatgpt.com"&&$.origin!=="https://chatgpt.com")return null;return v(Z)}catch{return null}}class E1{storage;constructor(Z=indexedDB,$="plannotator-annotations-v1"){this.storage=new x(Z,$,"annotations")}close(){return this.storage.close()}async apply(Z,$=Date.now()){let J=S1(Z);return this.storage.apply(J.key,()=>({key:J.key,revision:0,notes:[],tombstones:[]}),(Y)=>{let G=JSON.stringify(Y);T1(Y,J,$);let H=JSON.stringify(Y)!==G;if(H){if(Y.notes.length>bZ||JSON.stringify(Y.notes).length>b0)throw Error("This conversation has reached its annotation storage limit. Remove some notes and retry.");Y.revision++}let W={notes:structuredClone(Y.notes),revision:Y.revision,changed:H};return{value:Y,result:W,changed:H}})}}function f0(Z){return typeof Z==="string"&&/^[A-Za-z0-9:_-]{1,128}$/.test(Z)}function S1(Z){if(!Z||Z.type!==yZ||typeof Z.key!=="string"||Z.key.length>2048||!/^(chatgpt|claude|gemini|fixture):.+$/.test(Z.key))throw Error("Invalid annotation conversation");if(!["read","upsert","remove","import"].includes(Z.action))throw Error("Unknown annotation action");if(Z.action==="read")return{type:Z.type,key:Z.key,action:Z.action};if(Z.action==="remove"){if(!Array.isArray(Z.ids)||Z.ids.length>bZ||!Z.ids.every(f0))throw Error("Invalid annotation IDs");return{type:Z.type,key:Z.key,action:Z.action,ids:[...new Set(Z.ids)]}}if(!Array.isArray(Z.notes)||Z.notes.length>bZ)throw Error("Invalid annotation notes");let $=Z.notes.map(j1);if(new Set($.map((J)=>J.id)).size!==$.length)throw Error("Duplicate annotation IDs");if(JSON.stringify($).length>b0)throw Error("These annotations are too large to save in one request");return{type:Z.type,key:Z.key,action:Z.action,notes:$}}function j1(Z){if(!Z||!f0(Z.id)||typeof Z.messageId!=="string"||!Z.messageId||Z.messageId.length>512)throw Error("Invalid annotation identity");for(let $ of["messageExcerpt","quote","comment","contextBefore","contextAfter"])if(typeof Z[$]!=="string"||Z[$].length>h0)throw Error(`Annotation ${$} must contain at most ${h0.toLocaleString()} characters`);if(!Number.isFinite(Z.createdAt)||Z.createdAt<0)throw Error("Invalid annotation creation time");for(let $ of[Z.startOffset,Z.endOffset])if($!==void 0&&(!Number.isSafeInteger($)||$<0))throw Error("Invalid annotation selection offset");if(Z.startOffset!==void 0&&Z.endOffset!==void 0&&Z.startOffset>Z.endOffset)throw Error("Invalid annotation selection range");return{id:Z.id,messageId:Z.messageId,messageExcerpt:Z.messageExcerpt,quote:Z.quote,comment:Z.comment,contextBefore:Z.contextBefore,contextAfter:Z.contextAfter,...Z.startOffset!==void 0?{startOffset:Z.startOffset}:{},...Z.endOffset!==void 0?{endOffset:Z.endOffset}:{},createdAt:Z.createdAt}}function T1(Z,$,J){if($.action==="read")return;if($.action==="remove"){for(let Y of $.ids){let G=Z.notes.find((H)=>H.id===Y);if(Z.notes=Z.notes.filter((H)=>H.id!==Y),!Z.tombstones.some((H)=>H.id===Y))Z.tombstones.push({id:Y,createdAt:G?.createdAt??J})}while(Z.tombstones.length>k1){let Y=Z.tombstones.shift();Z.retiredBefore=Math.max(Z.retiredBefore??0,Y.createdAt)}return}for(let Y of $.notes){let G=Z.notes.findIndex((H)=>H.id===Y.id);if($.action==="import"&&(G>=0||Z.tombstones.some((H)=>H.id===Y.id)))continue;if(Z.tombstones.some((H)=>H.id===Y.id))throw Error("This annotation was removed in another tab. Create a new note to restore it.");if(G<0&&Z.retiredBefore!==void 0&&Y.createdAt<=Z.retiredBefore)throw Error("These older annotations may have been deleted. Keep their source copy and create a new note to restore them.");if(G<0)Z.notes.push(Y);else Z.notes[G]=Y}}var cZ="plannotator-chatgpt-root",x0="plannotator-chatgpt-page-style",v0="data-plannotator-message-id",lZ="plannotator-chatgpt-notes:v1:",dZ="plannotator-notes",uZ="plannotator-note-active",w1=120,g0=48,fZ=260,$Z=14,h1=140,q1=4,b1=1400,y1=120,f1=400;var x1=!1,v1="prod";var X={notes:[],activeNoteId:null,selectionDraft:null,draftEditorOpen:!1,draftText:"",notesMenuOpen:!1,actionFeedback:"idle",actionError:""},JZ=new Map,T=null,xZ=0,S=null,ZZ=0,p=0,pZ=0,vZ=0,m=null,j=null,N=null,_=[],y=0,p0=0,c=null,gZ=null,iZ=0;if(window.top===window)g1();function g1(){if(document.getElementById(cZ))return;p1();let Z=m1();T=Z,e1(Z),Z4(Z),document.addEventListener("selectionchange",()=>{if(xZ)return;xZ=window.requestAnimationFrame(()=>{xZ=0,a1(Z)})},!0),window.addEventListener("keydown",($)=>{let J=$.composedPath()[0],Y=J instanceof HTMLElement?J:null,G=(Y instanceof HTMLTextAreaElement||Y instanceof HTMLInputElement)&&Y.getRootNode()===Z.shadow;if(G)$.stopImmediatePropagation();let H=(Y instanceof HTMLTextAreaElement||Y instanceof HTMLInputElement)&&G&&Y.dataset.field==="draft";if($.shiftKey&&($.metaKey||$.ctrlKey)&&!$.altKey){let W=$.key.toLowerCase();if(W==="enter"){$.preventDefault(),YZ(Z);return}if(W==="i"){$.preventDefault(),YZ(Z);return}if(W==="c"){$.preventDefault(),navigator.clipboard.writeText(Z1());return}if(W==="k"){$.preventDefault(),h(),t1(),P(Z);return}}if(H&&$.key==="Enter"&&!$.shiftKey){$.preventDefault(),X.draftText=Y.value,r1(),P(Z);return}if($.key!=="Escape")return;if(X.notesMenuOpen){X.notesMenuOpen=!1,P(Z);return}if(H){w(),P(Z);return}if(w(),X.activeNoteId)X.activeNoteId=null;P(Z)},!0),document.addEventListener("pointerdown",($)=>{if($.composedPath().includes(Z.host))return;if(!X.activeNoteId&&!X.selectionDraft&&!X.notesMenuOpen)return;w(),X.activeNoteId=null,X.notesMenuOpen=!1,u(Z)},!0),window.addEventListener("resize",()=>u(Z),{passive:!0}),window.addEventListener("scroll",()=>l0(Z),{passive:!0}),document.addEventListener("scroll",()=>l0(Z),{passive:!0,capture:!0}),window.addEventListener("wheel",()=>d0(Z),{passive:!0,capture:!0}),window.addEventListener("touchmove",()=>d0(Z),{passive:!0,capture:!0}),window.addEventListener("pagehide",()=>{J1()},{capture:!0}),window.addEventListener("beforeunload",($)=>{if(!J4())return;$.preventDefault(),$.returnValue=""}),P(Z),$1(Z)}function p1(){if(document.getElementById(x0))return;let Z=document.createElement("style");Z.id=x0,Z.textContent=`
    ::highlight(${dZ}) {
      background: rgba(251, 191, 36, 0.35);
      color: inherit;
    }

    ::highlight(${uZ}) {
      background: rgba(245, 158, 11, 0.62);
      color: inherit;
    }
  `,document.head.appendChild(Z)}function m1(){let Z=document.createElement("div");if(Z.id=cZ,x1)Z.dataset.buildId=v1,Z.dataset.reloadState="booted";document.body.appendChild(Z);let $=Z.attachShadow({mode:"open"});$.innerHTML=`
    <style>
      :host {
        all: initial;
      }

      .icon { display: block; flex: none; pointer-events: none; }
      button:focus-visible { outline: 2px solid #458cff; outline-offset: 3px; }

      .shell {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483646;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
      }

      .selection-trigger,
      .note-popover,
      .notes-toolbar {
        pointer-events: auto;
      }

      .markers-layer,
      .popover-layer,
      .actions-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }

      .selection-trigger {
        position: fixed;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 999px;
        background: #1d4ed8;
        color: white;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 12px 28px rgba(29, 78, 216, 0.35);
        cursor: pointer;
      }

      .selection-trigger:hover {
        transform: translateY(-1px);
      }

      .note-popover {
        position: fixed;
        width: 260px;
        max-width: calc(100vw - 24px);
        background: transparent;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        backdrop-filter: none;
        padding: 0;
      }

      .note-popover-shell {
        position: relative;
      }

      .input {
        width: 100%;
        box-sizing: border-box;
        margin-top: 0;
        border: 1px solid rgba(37, 99, 235, 0.22);
        border-radius: 18px;
        padding: 10px 14px;
        font: inherit;
        font-size: 13px;
        line-height: 1.45;
        color: #0f172a;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14);
        resize: none;
        overflow-y: hidden;
      }

      .note-popover-shell.has-delete .input {
        padding-right: 38px;
      }

      .delete-note {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.08);
        color: #475569;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
      }

      .delete-note:hover {
        background: rgba(239, 68, 68, 0.14);
        color: #b91c1c;
      }

      .notes-toolbar {
        position: fixed;
        right: 18px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .notes-action,
      .notes-list-toggle {
        width: 42px;
        height: 42px;
        border: 0;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 13px;
        font-weight: 750;
        cursor: pointer;
        transition: transform 120ms ease, background 140ms ease, box-shadow 140ms ease;
      }

      .notes-action {
        background: #1d4ed8;
        color: white;
        box-shadow: 0 14px 30px rgba(29, 78, 216, 0.3);
      }

      .notes-list-toggle {
        background: rgba(255, 255, 255, 0.98);
        color: #92400e;
        border: 1px solid rgba(217, 119, 6, 0.35);
        box-shadow: 0 14px 30px rgba(15, 23, 42, 0.16);
      }

      .notes-list-toggle.active {
        background: #f59e0b;
        color: #111827;
        border-color: #f59e0b;
      }

      .notes-action:hover,
      .notes-list-toggle:hover {
        transform: translateY(-1px);
      }

      .notes-action.success {
        background: #16a34a;
        box-shadow: 0 14px 30px rgba(22, 163, 74, 0.28);
      }

      .notes-action.loading {
        background: #1e40af;
        box-shadow: 0 14px 30px rgba(30, 64, 175, 0.28);
      }

      .notes-action:disabled {
        cursor: default;
      }

      .notes-action.success:hover,
      .notes-action:disabled:hover {
        transform: none;
      }

      .notes-action svg {
        width: 16px;
        height: 16px;
        display: block;
      }

      .notes-menu {
        position: absolute;
        right: 0;
        bottom: 52px;
        width: min(340px, calc(100vw - 36px));
        max-height: min(420px, calc(100vh - 132px));
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 22px 52px rgba(15, 23, 42, 0.2);
        padding: 6px;
        box-sizing: border-box;
      }

      .notes-menu-row {
        width: 100%;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #0f172a;
        display: grid;
        grid-template-columns: 26px minmax(0, 1fr);
        column-gap: 10px;
        align-items: start;
        padding: 9px 8px;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .notes-menu-row:hover,
      .notes-menu-row.active {
        background: rgba(251, 191, 36, 0.22);
      }
      .notes-menu-item { display: flex; align-items: center; }
      .notes-menu-item .notes-menu-row { min-width: 0; }
      .notes-menu-delete { flex: none; width: 30px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: #64748b; cursor: pointer; }
      .notes-menu-delete:hover { background: #fee2e2; color: #b91c1c; }
      .notes-help { padding: 8px; margin: 0; font-size: 11px; color: #64748b; }
      .notes-status { max-width: min(340px, calc(100vw - 150px)); padding: 8px 10px; border-radius: 8px; background: white; box-shadow: 0 4px 18px #0f172a22; font-size: 12px; }
      .notes-status.error { color: #991b1b; }
      .notes-status button { margin-left: 6px; font: inherit; cursor: pointer; }

      .notes-menu-index {
        width: 22px;
        height: 22px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.18);
        color: #92400e;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
      }

      .notes-menu-text {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .notes-menu-comment,
      .notes-menu-quote {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .notes-menu-comment {
        font-size: 13px;
        font-weight: 700;
        color: #0f172a;
      }

      .notes-menu-quote {
        font-size: 12px;
        color: #64748b;
      }

      .notes-action-spinner {
        animation: notes-action-spin 720ms linear infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .notes-action-spinner { animation: none; }
      }

      @keyframes notes-action-spin {
        from {
          transform: rotate(0deg);
        }

        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 720px) {
        .note-popover {
          width: min(260px, calc(100vw - 20px));
        }
      }
    </style>
    <div class="shell">
      <div class="markers-layer" id="markers-layer"></div>
      <div class="popover-layer" id="popover-layer"></div>
      <div class="actions-layer" id="actions-layer"></div>
    </div>
  `;let J=$.getElementById("markers-layer"),Y=$.getElementById("popover-layer"),G=$.getElementById("actions-layer");if(!J||!Y||!G)throw Error("Threadlane extension failed to initialize its UI");let H={host:Z,shadow:$,markersLayer:J,popoverLayer:Y,actionsLayer:G};$.addEventListener("pointerdown",(D)=>{let V=D.target;if(V?.closest("[data-action='open-draft']")){D.preventDefault(),X.draftEditorOpen=!0,X.activeNoteId=null,P(H);return}if(V?.closest("[data-action='insert-notes']")){if(D.preventDefault(),X.notes.length===0||X.actionFeedback!=="idle")return;YZ(H);return}}),$.addEventListener("click",(D)=>{let V=D.target;if(!V)return;if(V.closest("[data-action='retry-notes']")){Y4();return}if(V.closest("[data-action='open-draft']")){if(D instanceof MouseEvent&&D.detail===0)X.draftEditorOpen=!0,X.activeNoteId=null,P(H);return}if(V.closest("[data-action='insert-notes']")){if(D instanceof MouseEvent&&D.detail===0&&X.notes.length>0&&X.actionFeedback==="idle")YZ(H);return}if(V.closest("[data-action='toggle-notes-menu']")){if(HZ().length===0)return;X.notesMenuOpen=!X.notesMenuOpen,P(H);return}let B=V.closest("[data-action='jump-note']");if(B?.dataset.noteId){H4(B.dataset.noteId,H);return}let F=V.closest("[data-action='delete-note']");if(F){let Q=F.closest("[data-note-id]")?.dataset.noteId;if(!Q)return;s1(Q),P(H);return}return});let W=(D)=>{if(N!==M()){if(D.dataset.field==="draft")X.draftText=D.value;q();return}if(D.dataset.field==="draft")X.draftText=D.value;else{let V=D.closest("[data-note-id]")?.dataset.noteId;if(V)n1(V,{comment:D.value})}sZ(D)};$.addEventListener("input",(D)=>{let V=D.composedPath()[0];if(V instanceof HTMLTextAreaElement||V instanceof HTMLInputElement)W(V)});for(let D of["keypress","keyup","beforeinput","input","paste","copy","cut"])window.addEventListener(D,(V)=>{let B=V.composedPath()[0];if(!(B instanceof HTMLTextAreaElement||B instanceof HTMLInputElement)||B.getRootNode()!==$)return;if(V.stopImmediatePropagation(),D!=="input")return;W(B)},!0);return H}function P(Z){c1(),l1(Z),i1(Z),d1(Z),W4()}function c1(){let Z=!1;X.notes=X.notes.flatMap(($)=>{if(B4($.range))return[$];let J=J0($);if(!J)return[$];return Z=!0,[J]})}function l1(Z){Z.markersLayer.innerHTML=""}function d1(Z){let $=X.actionFeedback==="loading",J=X.actionFeedback==="inserted",Y=HZ(),G=L(),H=Array.from(JZ.values()).find((K)=>K!==G&&(K.pending.size>0||K.draft?.text.trim()||!K.key&&K.notes.size)),W=G.error||G.migrationError||X.actionError,D=W||(G.pending.size||G.loading||G.flushing?"Saving notes…":"");if(Y.length===0&&!$&&!J&&!D&&!H){Z.actionsLayer.innerHTML="";return}let V=mZ(),B=24;if(V instanceof HTMLElement){let K=V.getBoundingClientRect();if(K.top<window.innerHeight)B=A(window.innerHeight-K.top+18,24,180)}let F=X.notesMenuOpen&&Y.length>0?u1():"",Q=Y.length>0?`
    <button
      class="notes-list-toggle${X.notesMenuOpen?" active":""}"
      data-action="toggle-notes-menu"
      type="button"
      title="Show notes"
      aria-label="Show notes"
      aria-expanded="${X.notesMenuOpen?"true":"false"}"
    >${Y.length}</button>
  `:"";Z.actionsLayer.innerHTML=`
    <div class="notes-toolbar" style="bottom:${B}px;">
      ${F}
      ${D?`<span class="notes-status${W?" error":""}" role="${W?"alert":"status"}">${E(D)}${G.error||G.migrationError?'<button data-action="retry-notes" type="button">Retry save</button>':""}</span>`:""}
      ${H?`<span class="notes-status error" role="alert">Notes in another chat are not saved. <a href="${E(H.route.slice(lZ.length))}">Return to save</a></span>`:""}
      ${Q}
    <button
      class="notes-action${$?" loading":""}${J?" success":""}"
      data-action="insert-notes"
      type="button"
      title="${$?"Inserting into":J?"Inserted into":"Insert notes into"} ${NZ()}"
      aria-label="${$?"Inserting into":J?"Inserted into":"Insert notes into"} ${NZ()}"
      data-state="${$?"loading":J?"success":"idle"}"
      ${$||J||X.notes.length===0?"disabled":""}
    >
      ${$?b("loader",16,"notes-action-spinner"):J?b("check"):b("arrow-right")}
    </button>
    </div>
  `}function u1(){return`
    <section class="notes-menu" aria-label="Saved notes">
      <p class="notes-help">Saved notes remain until you delete them.</p>
      ${HZ().map((Z,$)=>`
        <div class="notes-menu-item" data-note-id="${E(Z.id)}">
        <button
          class="notes-menu-row${Z.id===X.activeNoteId?" active":""}"
          data-action="jump-note"
          data-note-id="${E(Z.id)}"
          type="button"
          title="${E(Z.comment||Z.quote)}"
          aria-label="Jump to note ${$+1}"
        >
          <span class="notes-menu-index">${$+1}</span>
          <span class="notes-menu-text">
            <span class="notes-menu-comment">${E(a0(Z.comment||"Untitled note",80))}</span>
            <span class="notes-menu-quote">${E(a0(Z.quote,90))}</span>
          </span>
        </button>
        <button class="notes-menu-delete" data-action="delete-note" type="button" aria-label="Delete note ${$+1}" title="Delete note ${$+1}">${b("trash")}</button>
        </div>
      `).join("")}
    </section>
  `}function i1(Z){let $=X.selectionDraft;if(!$){l(),Z.popoverLayer.innerHTML="";return}if(!X.draftEditorOpen){l();let Q=u0($.rect),K=X4($.rect,Q),U=A($.rect.top+$.rect.height/2-12,12,window.innerHeight-24-12);Z.popoverLayer.innerHTML=`
      <button
        class="selection-trigger"
        data-action="open-draft"
        type="button"
        aria-label="Add note"
        title="Add note"
        style="left:${K}px;top:${U}px;"
      >${b("plus")}</button>
    `;return}let J=e0($),Y=u0($.rect),G=$.rect,H=Z.popoverLayer.querySelector(".note-popover[data-draft-editor='true']"),W=H?.querySelector("textarea[data-field='draft']")??null,D=!1;if(!H||!W||H.dataset.draftKey!==J){if(l(),Z.popoverLayer.innerHTML=`
      <section class="note-popover" data-draft-editor="true">
        <div class="note-popover-shell">
          <textarea
            class="input"
            data-field="draft"
            placeholder="Type a note and press Enter"
            rows="1"
            autocomplete="off"
            spellcheck="true"
          ></textarea>
        </div>
      </section>
    `,H=Z.popoverLayer.querySelector(".note-popover"),W=H?.querySelector("textarea[data-field='draft']")??null,!H||!W)return;H.dataset.draftKey=J,W.value=X.draftText,D=!0}else if(W.value!==X.draftText){let Q=Z.shadow.activeElement===W,K=W.selectionStart,U=W.selectionEnd;if(W.value=X.draftText,Q){let Y0=W.value.length;W.setSelectionRange(Math.min(K,Y0),Math.min(U,Y0))}}H.dataset.side=Y,sZ(W),H.style.left="-9999px",H.style.top="-9999px";let V=H.offsetHeight||52,B=D4(Y,G),F=A(G.top+G.height/2-V/2,12,window.innerHeight-V-12);if(H.style.left=`${B}px`,H.style.top=`${F}px`,D)F4(Z,J,W)}function e0(Z){return JSON.stringify([Z.messageId,Z.startOffset,Z.endOffset,Z.quote])}function a1(Z){if(aZ(Z),O4(Z))return;let $=o1();ZZ+=1;let J=ZZ;if(S)clearTimeout(S),S=null;if(!$){if(!X.draftEditorOpen||!X.selectionDraft)X.selectionDraft=null,X.draftEditorOpen=!1;P(Z);return}S=setTimeout(()=>{if(J!==ZZ)return;let Y=X.selectionDraft?.messageId??null,G=$.messageId;if(Y!==G||X.selectionDraft?.quote!==$.quote)X.draftText="",X.draftEditorOpen=!1,X.activeNoteId=null;X.selectionDraft=$,P(Z)},h1)}function o1(){let Z=document.getSelection();if(!Z||Z.isCollapsed||Z.rangeCount===0)return null;let $=Z.getRangeAt(0);if(!$||$.collapsed)return null;let J=i0($.startContainer),Y=i0($.endContainer);if(!J||J!==Y)return null;if(P4($.commonAncestorContainer))return null;let G=O(Z.toString()).trim();if(!G)return null;let H=Q4($)??$.getBoundingClientRect();if(!H.width&&!H.height)return null;let W=tZ(J),D=C4(J,$),V=DZ(J);return{messageId:W,quote:G,range:V1($),messageExcerpt:O(V).slice(0,w1),contextBefore:O(V.slice(Math.max(0,D.start-g0),D.start)),contextAfter:O(V.slice(D.end,D.end+g0)),startOffset:D.start,endOffset:D.end,rect:H}}function r1(){if(!q())return;let Z=X.selectionDraft;if(!Z)return;let $=X.draftText.trim();if(!$){w();return}let J={id:crypto.randomUUID(),messageId:Z.messageId,messageExcerpt:Z.messageExcerpt,quote:Z.quote,comment:$,contextBefore:Z.contextBefore,contextAfter:Z.contextAfter,startOffset:Z.startOffset,endOffset:Z.endOffset,range:Z.range,createdAt:Date.now()};h(),X.notes.push(J),X.activeNoteId=null,w(),WZ({action:"upsert",note:Z0(J)},!0)}function n1(Z,$){if(!q())return;let J=X.notes.find((Y)=>Y.id===Z);if(!J)return;if($.comment!==void 0)J.comment=$.comment;WZ({action:"upsert",note:Z0(J)})}function s1(Z){if(!q())return;let $=H1().filter((J)=>J.id!==Z);if(X.notes=$,X.activeNoteId===Z)X.activeNoteId=$.at(-1)?.id??null;_=_.filter((J)=>J.id!==Z),WZ({action:"remove",id:Z},!0)}function t1(){if(!q())return;let Z=HZ().map((J)=>J.id);X.notes=[],X.activeNoteId=null,X.notesMenuOpen=!1,_=[],GZ(),w();let $=CSS.highlights;$?.set(dZ,new Highlight),$?.set(uZ,new Highlight);for(let J of Z)WZ({action:"remove",id:J});J1()}function Z1(){if(X.notes.length===0)return"Select assistant text and add at least one note.";return H1().map((Z)=>[`user: ${t0(Z.comment)}`,`responding to AI selected text: ${t0(Z.quote)}`].join(`
`)).join(`

`).trim()}async function YZ(Z){if(!q())return;if(X.notes.length===0||X.actionFeedback==="loading")return;let $=mZ();if(!$){X.actionError="The composer is unavailable. Your notes are still saved here.",P(Z);return}if(c0($).trim()||LZ()){X.actionError="Send or clear the current draft before inserting notes.",P(Z);return}let J=M(),Y=Z1();if(X.actionError="",h(),X.actionFeedback="loading",P(Z),await w4(),J!==M()||!$.isConnected||mZ()!==$||c0($).trim()||LZ()){h(),X.actionError="The conversation or draft changed. Your notes were kept.",P(Z);return}if(!G4($,Y)){h(),X.actionError="Could not insert notes. Your notes were kept.",P(Z);return}T4(Z),P(Z)}function e1(Z){if(N=M(),p0)return;Y1()?.onMessage?.addListener(($)=>{let J=L();if($.type===q0&&$.key===J.key)m0(J)}),p0=window.setInterval(()=>aZ(Z),f1),document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")m0(L())})}function aZ(Z){let $=M();if($===N)return;let J=L();if(X.selectionDraft&&X.draftText.trim())J.draft={selection:X.selectionDraft,text:X.draftText};GZ(),_=[],h(),w(!1),X.notes=[],X.activeNoteId=null,X.notesMenuOpen=!1,X.actionError="",N=$;let Y=L();if(Y.draft)X.selectionDraft=Y.draft.selection,X.draftText=Y.draft.text,X.draftEditorOpen=!0;I(Y),P(Z),$1(Z)}function q(){if(!N)return N=M(),!0;if(N===M())return!0;if(T)aZ(T);return!1}function Z4(Z){if(gZ||!document.body)return;gZ=new MutationObserver(()=>{if(_.length>0)$0(Z);if(X.notes.length>0)u(Z)}),gZ.observe(document.body,{childList:!0,subtree:!0,characterData:!0})}async function $1(Z){T=Z,N??=M();let $=L();if(await VZ($),$.pending.size)await i($)}function $4(){if(j)clearTimeout(j);let Z=L();j=window.setTimeout(()=>{j=null,i(Z)},y1)}async function J1(){if(j)clearTimeout(j),j=null;await i(L())}function Y1(){return globalThis.chrome?.runtime}function L(){let Z=N??M(),$=JZ.get(Z);if(!$)$={route:Z,key:y0(Z.slice(lZ.length)),notes:new Map,saved:new Map,pending:new Map,revision:-1,loaded:!1,loading:null,flushing:null,error:"",migrationError:"",draft:null},JZ.set(Z,$);return $}function HZ(){let Z=new Map(L().notes);for(let $ of _)if(!Z.has($.id))Z.set($.id,$);for(let $ of X.notes)Z.set($.id,Z0($));return Array.from(Z.values()).sort(($,J)=>$.createdAt-J.createdAt)}function J4(){return Boolean(X.draftText.trim()||Array.from(JZ.values()).some((Z)=>Z.pending.size||Z.draft?.text.trim()||!Z.key&&Z.notes.size))}function I(Z){if(Z.route!==N||Z.route!==M())return;let $=new Map(X.notes.map((J)=>[J.id,J]));X.notes=[],_=[];for(let J of Z.notes.values()){let Y=J0(J),G=$.get(J.id);if(Y)X.notes.push(Y);else if(G)X.notes.push({...G,comment:J.comment});else _.push(J)}if(T){if(_.length)$0(T);P(T)}}function oZ(Z,$){if($.revision>=Z.revision)Z.revision=$.revision,Z.saved=new Map($.notes.map((J)=>[J.id,J]));Z.notes=new Map(Z.saved);for(let[J,Y]of Z.pending)if(Y.action==="remove")Z.notes.delete(J);else Z.notes.set(J,Y.note);I(Z)}async function rZ(Z,$,J={}){if(!Z.key)throw Error("Open a saved conversation to save these notes.");let Y=Y1();if(!Y?.sendMessage)throw Error("Extension storage is unavailable. Keep this tab open and retry saving.");let G=await Y.sendMessage({type:yZ,key:Z.key,action:$,...J});if(!G?.ok||!Array.isArray(G.notes)||typeof G.revision!=="number")throw Error(G?.error||"The save was not confirmed. Keep this tab open and retry saving.");return{notes:G.notes,revision:G.revision}}function nZ(Z,$){Z.error=`Notes not saved: ${$ instanceof Error?$.message:String($)}`,I(Z)}async function VZ(Z){if(!Z.key){let $=null;Z.migrationError="";try{if($=window.localStorage.getItem(Z.route),$){let J=JSON.parse($);if(!Array.isArray(J)||!J.every(o0))throw Error("The original notes could not be read.");for(let Y of J)if(!Z.notes.has(Y.id)&&!Z.pending.has(Y.id))Z.notes.set(Y.id,Y)}}catch{if($)Z.migrationError="Existing notes could not be read. Their original copy has been kept."}Z.error=Z.notes.size||Z.pending.size?"This chat is not saved. These notes are not saved in extension storage; keep this tab open.":"",I(Z);return}if(Z.loading)return Z.loading;return Z.loading=Promise.resolve().then(async()=>{try{let $=null,J=[];Z.migrationError="";try{if($=window.localStorage.getItem(Z.route),$){let G=JSON.parse($);if(!Array.isArray(G)||!G.every(o0))throw Error("The original notes could not be read.");J=G;for(let H of J)if(!Z.notes.has(H.id))Z.notes.set(H.id,H);I(Z)}}catch(G){$=null,Z.migrationError=`Legacy notes were kept but could not be imported: ${G instanceof Error?G.message:String(G)}`}let Y=await rZ(Z,$?"import":"read",$?{notes:J}:{});if(oZ(Z,Y),$&&window.localStorage.getItem(Z.route)===$)window.localStorage.removeItem(Z.route);Z.loaded=!0,Z.error=""}catch($){nZ(Z,$)}}).finally(()=>{Z.loading=null,I(Z)}),Z.loading}async function m0(Z){if(!Z.loaded){await VZ(Z);return}try{oZ(Z,await rZ(Z,"read"))}catch($){nZ(Z,$)}}function WZ(Z,$=!1){let J=L(),Y=Z.action==="remove"?Z.id:Z.note.id;if(J.pending.set(Y,Z),Z.action==="remove")J.notes.delete(Y);else J.notes.set(Y,Z.note);if(J.error="",$)i(J);else $4()}async function i(Z){if(Z.flushing)return Z.flushing;return Z.flushing=(async()=>{if(!Z.loaded)await VZ(Z);if(!Z.loaded)return;try{while(Z.pending.size){let $=Z.pending.values().next().value.action,J=Array.from(Z.pending.entries()).filter(([,H])=>H.action===$),Y=$==="remove"?{ids:J.map(([H])=>H)}:{notes:J.map(([,H])=>H.note)},G=await rZ(Z,$,Y);for(let[H,W]of J)if(Z.pending.get(H)===W)Z.pending.delete(H);oZ(Z,G),Z.error=""}}catch($){nZ(Z,$)}})().finally(()=>{Z.flushing=null,I(Z)}),Z.flushing}async function Y4(){if(!q())return;let Z=L();Z.error="",await VZ(Z),await i(Z),I(Z)}function mZ(){return r()}function c0(Z){return _Z(Z)}function G4(Z,$){let J=M0(Z,$);if(J)Z.focus();return J}function H4(Z,$){let J=X.notes.find((Y)=>Y.id===Z);if(!J)return;X.activeNoteId=Z,X.notesMenuOpen=!1,iZ=Date.now()+900,P($),V4(J)}function V4(Z){let $=G1(Z.range);if(!$)return;let J=$.getBoundingClientRect();if(J.width||J.height){let G=J.top-window.innerHeight*0.35;window.scrollBy({top:G,behavior:"smooth"});return}($.startContainer instanceof Element?$.startContainer:$.startContainer.parentElement)?.scrollIntoView({behavior:"smooth",block:"center"})}function l0(Z){if(X.activeNoteId&&Date.now()>iZ)X.activeNoteId=null;u(Z)}function d0(Z){if(!X.activeNoteId)return;X.activeNoteId=null,iZ=0,u(Z)}function W4(){let Z=CSS.highlights;if(!Z)return;let $=X.notes.find((Y)=>Y.id===X.activeNoteId),J=X.notes.filter((Y)=>Y.id!==$?.id).map((Y)=>Y.range);Z.set(dZ,new Highlight(...J)),Z.set(uZ,$?new Highlight($.range):new Highlight)}function u0(Z){let $=Z.left;return window.innerWidth-Z.right>=$?"right":"left"}function D4(Z,$){if(Z==="right")return A($.right+$Z,12,window.innerWidth-fZ-12);return A($.left-fZ-$Z,12,window.innerWidth-fZ-12)}function X4(Z,$){if($==="right")return A(Z.right+$Z,12,window.innerWidth-24-12);return A(Z.left-24-$Z,12,window.innerWidth-24-12)}function B4(Z){let $=G1(Z);if(!$)return null;let J=$.getBoundingClientRect();if(!J.width&&!J.height)return null;return J}function Q4(Z){return Array.from(Z.getClientRects()).filter((J)=>J.width||J.height).at(-1)??null}function G1(Z){if(Z instanceof Range)return Z.cloneRange();try{let $=document.createRange();return $.setStart(Z.startContainer,Z.startOffset),$.setEnd(Z.endContainer,Z.endOffset),$}catch{return null}}function l(){if(pZ+=1,!p)return;window.cancelAnimationFrame(p),p=0}function F4(Z,$,J){l();let Y=pZ;p=window.requestAnimationFrame(()=>{if(p=0,Y!==pZ)return;let G=X.selectionDraft;if(!G||!X.draftEditorOpen||e0(G)!==$)return;if(Z.popoverLayer.querySelector("textarea[data-field='draft']")!==J||!J.isConnected)return;sZ(J),J.focus({preventScroll:!0});let W=J.value.length;J.setSelectionRange(W,W)})}function sZ(Z){if(!(Z instanceof HTMLTextAreaElement))return;let $=window.getComputedStyle(Z),J=parseFloat($.lineHeight)||18,Y=parseFloat($.paddingTop)+parseFloat($.paddingBottom),G=parseFloat($.borderTopWidth)+parseFloat($.borderBottomWidth),H=J*q1+Y+G;Z.style.height="0px";let W=Math.min(Z.scrollHeight,H);Z.style.height=`${W}px`,Z.style.overflowY=Z.scrollHeight>H?"auto":"hidden"}function u(Z){if(vZ)return;vZ=window.requestAnimationFrame(()=>{vZ=0,P(Z)})}function w(Z=!0){if(Z)L().draft=null;if(l(),ZZ+=1,S)clearTimeout(S),S=null;X.selectionDraft=null,X.draftEditorOpen=!1,X.draftText="",document.getSelection()?.removeAllRanges()}function H1(){return[...X.notes].sort((Z,$)=>Z.createdAt-$.createdAt)}function i0(Z){return MZ(Z)}function tZ(Z){let $=Z.getAttribute(v0);if(!$)$=K4(Z),Z.setAttribute(v0,$);return $}function K4(Z){let $=T0(Z);if($)return $;let Y=eZ().indexOf(Z),G=O(DZ(Z)).slice(0,96);return`assistant-${Y}-${j4(G)}`}function eZ(){return j0()}function P4(Z){let $=Z instanceof HTMLElement?Z:Z?.parentElement??null;if(!$)return!1;return Boolean($.closest(`#${cZ}`))}function V1(Z){try{return new StaticRange({startContainer:Z.startContainer,startOffset:Z.startOffset,endContainer:Z.endContainer,endOffset:Z.endOffset})}catch{return Z.cloneRange()}}function C4(Z,$){let J=document.createTreeWalker(Z,NodeFilter.SHOW_TEXT),Y=0,G=0,H=0;while(J.nextNode()){let W=J.currentNode,D=W.textContent?.length??0;if(W===$.startContainer)G=Y+$.startOffset;if(W===$.endContainer){H=Y+$.endOffset;break}Y+=D}if(H<G)H=G+$.toString().length;return{start:G,end:H}}function DZ(Z){let $=document.createTreeWalker(Z,NodeFilter.SHOW_TEXT),J="";while($.nextNode())J+=$.currentNode.textContent??"";return J}function O(Z){return Z.replace(/\s+/g," ").trim()}function a0(Z,$){let J=O(Z);if(J.length<=$)return J;return`${J.slice(0,$-1)}...`}function A(Z,$,J){return Math.max($,Math.min(J,Z))}function E(Z){return Z.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function O4(Z){let $=Z.shadow.activeElement;return($ instanceof HTMLTextAreaElement||$ instanceof HTMLInputElement)&&$.dataset.field==="draft"}function M(){return`${lZ}${window.location.origin}${window.location.pathname}`}function o0(Z){if(!Z||typeof Z!=="object")return!1;let $=Z;return typeof $.id==="string"&&typeof $.messageId==="string"&&typeof $.messageExcerpt==="string"&&typeof $.quote==="string"&&typeof $.comment==="string"&&typeof $.contextBefore==="string"&&typeof $.contextAfter==="string"&&($.startOffset===void 0||typeof $.startOffset==="number")&&($.endOffset===void 0||typeof $.endOffset==="number")&&typeof $.createdAt==="number"}function Z0(Z){return{id:Z.id,messageId:Z.messageId,messageExcerpt:Z.messageExcerpt,quote:Z.quote,comment:Z.comment,contextBefore:Z.contextBefore,contextAfter:Z.contextAfter,startOffset:Z.startOffset,endOffset:Z.endOffset,createdAt:Z.createdAt}}function $0(Z){if(y)return;y=window.requestAnimationFrame(()=>{y=0,U4(Z)})}function U4(Z){if(_.length===0){GZ(),P(Z);return}let $=new Map(X.notes.map((G)=>[G.id,G])),J=[],Y=!1;for(let G of _){if($.has(G.id))continue;let H=J0(G);if(!H){J.push(G);continue}if($.set(H.id,H),!D1(G)||H.quote!==G.quote)Y=!0}if(X.notes=Array.from($.values()).sort((G,H)=>G.createdAt-H.createdAt),_=J,P(Z),_.length>0)R4(Z);else GZ()}function R4(Z){if(c||!document.body)return;c=new MutationObserver(()=>{$0(Z)}),c.observe(document.body,{childList:!0,subtree:!0,characterData:!0})}function GZ(){if(y)window.cancelAnimationFrame(y),y=0;c?.disconnect(),c=null}function J0(Z){let $=_4(Z);if(!$)return null;let J=z4($,Z);if(!J)return null;return{...Z,messageId:tZ($),quote:J.quote,startOffset:J.startOffset,endOffset:J.endOffset,range:V1(J.range)}}function _4(Z){let $=L4(Z.messageId);if($)return $;let J=O(Z.messageExcerpt),Y=null,G=-1;for(let H of eZ()){let W=O(DZ(H)),D=0;if(J&&W.includes(J))D+=J.length*2;if(Z.quote&&W.includes(O(Z.quote)))D+=Math.min(O(Z.quote).length,240);if(Z.contextBefore&&W.includes(O(Z.contextBefore)))D+=Z.contextBefore.length;if(Z.contextAfter&&W.includes(O(Z.contextAfter)))D+=Z.contextAfter.length;if(D>G)G=D,Y=H}return Y}function L4(Z){for(let $ of eZ())if(tZ($)===Z)return $;return null}function z4(Z,$){let J=DZ(Z);if(!J)return null;if(D1($)){let H=s0(Z,$.startOffset,$.endOffset);if(H&&N4(H,$.quote))return{range:H,quote:O(H.toString())||$.quote,startOffset:$.startOffset,endOffset:$.endOffset}}let Y=M4(J,$);if(!Y)return null;let G=s0(Z,Y.start,Y.end);if(!G)return null;return{range:G,quote:O(G.toString())||$.quote,startOffset:Y.start,endOffset:Y.end}}function N4(Z,$){let J=d(Z.toString()),Y=d($);return Boolean(J)&&J===Y}function M4(Z,$){let J=O($.quote);if(!J)return null;let Y=J.split(" ").filter(Boolean),G=E4(Z);if(!G.text)return null;let H={contextBefore:O($.contextBefore),contextAfter:O($.contextAfter)},W=r0(G.text,J,Y,H," ");if(W)return n0(G,Z.length,W.start,W.end);let D=S4(Z),V=d($.quote);if(!D.text||!V)return null;let B=r0(D.text,V,Y,{contextBefore:d($.contextBefore),contextAfter:d($.contextAfter)},"");if(!B)return null;return n0(D,Z.length,B.start,B.end)}function r0(Z,$,J,Y,G){let H=null,W=0;while(W<Z.length){let D=Z.indexOf($,W);if(D===-1)break;let V=D+$.length,B=W1(Z,D,V,Y);if(!H||B>H.score)H={start:D,end:V,score:B};W=D+Math.max(1,$.length)}if(H)return H;return A4(Z,J,Y,G)}function W1(Z,$,J,Y){let G=O(Y.contextBefore),H=O(Y.contextAfter),W=Z.slice(Math.max(0,$-G.length),$),D=Z.slice(J,J+H.length);return I4(W,G)*2+k4(D,H)*2}function A4(Z,$,J,Y){if($.length===0)return null;let G=Math.min($.length,14),H=Math.min(G,3),W=null;for(let D=G;D>=H;D-=1){for(let V=0;V+D<=$.length;V+=1){let B=$.slice(V,V+D).join(Y),F=0;while(F<Z.length){let Q=Z.indexOf(B,F);if(Q===-1)break;let K=Q+B.length,U=W1(Z,Q,K,J)+B.length*4-V;if(!W||U>W.score)W={start:Q,end:K,score:U};F=Q+Math.max(1,B.length)}}if(W)return W}return null}function I4(Z,$){let J=0,Y=Z.length-1,G=$.length-1;while(Y>=0&&G>=0){if(Z[Y]!==$[G])break;J+=1,Y-=1,G-=1}return J}function k4(Z,$){let J=0,Y=Math.min(Z.length,$.length);while(J<Y){if(Z[J]!==$[J])break;J+=1}return J}function E4(Z){let $="",J=[],Y=!1,G=!1;for(let H=0;H<Z.length;H+=1){let W=Z[H];if(/\s/.test(W)){if(!Y||G)continue;$+=" ",J.push(H),G=!0;continue}$+=W,J.push(H),Y=!0,G=!1}if($.endsWith(" "))$=$.slice(0,-1),J.pop();return{text:$,rawByNormalized:J}}function S4(Z){let $="",J=[];for(let Y=0;Y<Z.length;Y+=1){let G=Z[Y];if(/\s/.test(G))continue;$+=G,J.push(Y)}return{text:$,rawByNormalized:J}}function n0(Z,$,J,Y){let G=Z.rawByNormalized[J],H=Y<Z.rawByNormalized.length?Z.rawByNormalized[Y]:$;if(typeof G!=="number")return null;return{start:G,end:Math.max(G+1,H)}}function s0(Z,$,J){if(J<=$)return null;let Y=document.createTreeWalker(Z,NodeFilter.SHOW_TEXT),G=0,H=null,W=null,D=0,V=0,B=null;while(Y.nextNode()){let Q=Y.currentNode,K=Q.textContent?.length??0,U=G+K;if(B=Q,!H&&$<=U)H=Q,D=A($-G,0,K);if(!W&&J<=U){W=Q,V=A(J-G,0,K);break}G=U}if(!H)return null;if(!W){if(!B)return null;W=B,V=B.textContent?.length??0}if(H===W&&V<=D)return null;let F=document.createRange();return F.setStart(H,D),F.setEnd(W,V),F.collapsed?null:F}function D1(Z){return typeof Z.startOffset==="number"&&typeof Z.endOffset==="number"&&Z.endOffset>Z.startOffset}function t0(Z){return JSON.stringify(O(Z))}function d(Z){return Z.replace(/\s+/g,"")}function j4(Z){let $=5381;for(let J=0;J<Z.length;J+=1)$=($<<5)+$^Z.charCodeAt(J);return Math.abs($).toString(36)}function h(){if(X.actionFeedback="idle",m)clearTimeout(m),m=null}function T4(Z){h(),X.actionFeedback="inserted",m=window.setTimeout(()=>{X.actionFeedback="idle",m=null,P(Z)},b1)}function w4(){return new Promise((Z)=>window.requestAnimationFrame(()=>Z()))}})();
