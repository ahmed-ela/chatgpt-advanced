(()=>{var{defineProperty:$Z,getOwnPropertyNames:R0,getOwnPropertyDescriptor:E0}=Object,N0=Object.prototype.hasOwnProperty;var SZ=new WeakMap,d1=(Z)=>{var $=SZ.get(Z),J;if($)return $;if($=$Z({},"__esModule",{value:!0}),Z&&typeof Z==="object"||typeof Z==="function")R0(Z).map((Y)=>!N0.call($,Y)&&$Z($,Y,{get:()=>Z[Y],enumerable:!(J=E0(Z,Y))||J.enumerable}));return SZ.set(Z,$),$};var i1=(Z,$)=>{for(var J in $)$Z(Z,J,{get:$[J],enumerable:!0,configurable:!0,set:(Y)=>$[J]=()=>Y})};var a1="plannotator:queue",n1="plannotator:queue:changed";function YZ(Z){try{let $=new URL(Z);if($.username||$.password)return null;if($.protocol==="https:"&&$.hostname==="chatgpt.com"){let J=$.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)(?:\/|$)/);return J?`chatgpt:${J[1]}`:null}if($.origin==="https://claude.ai"){let J=$.pathname.match(/^\/chat\/([A-Za-z0-9_-]{1,128})\/?$/);return J?`claude:${J[1]}`:null}if($.origin==="https://gemini.google.com"){let J=$.pathname.match(/^\/app\/([A-Za-z0-9_-]{1,128})\/?$/);return J?`gemini:${J[1]}`:null}if($.protocol==="http:"&&["localhost","127.0.0.1"].includes($.hostname))return`fixture:${$.origin}${$.pathname}`}catch{}return null}class z0{factory;name;connection;constructor(Z=indexedDB,$="plannotator-message-queue-v1"){this.factory=Z;this.name=$}database(){if(!this.connection)this.connection=new Promise((Z,$)=>{let J=this.factory.open(this.name,1);J.onupgradeneeded=()=>J.result.createObjectStore("queues",{keyPath:"key"}),J.onerror=()=>{this.connection=void 0,$(J.error??Error("Could not open queue storage"))},J.onblocked=()=>{this.connection=void 0,$(Error("Queue storage is busy; close older extension pages and retry"))},J.onsuccess=()=>{let Y=J.result;Y.onversionchange=()=>{Y.close(),this.connection=void 0},Z(Y)}});return this.connection}async close(){if(this.connection)(await this.connection).close();this.connection=void 0}async apply(Z,$,J=Date.now()){if(L0(Z),!$||$.length>256)throw Error("Invalid queue client");let Y=await this.database();return new Promise((X,j)=>{let D=Y.transaction("queues","readwrite",{durability:"strict"}),U=D.objectStore("queues"),G=U.get(Z.key),V,W;G.onsuccess=()=>{try{let _=G.result??{key:Z.key,revision:0,paused:!1,items:[],busyLeases:[]},O=JSON.stringify(_);k0(_,J);let M=I0(_,Z,$,J),h=JSON.stringify(_)!==O;if(h)_.revision+=1,U.put(_);let{retiredIds:m1,editReceipts:c1,busyLeases:l1,legacyBusyUntil:u1,...P0}=_;V={state:structuredClone(P0),changed:h,...M?{claimed:structuredClone(M)}:{}}}catch(_){W=_,D.abort()}},D.oncomplete=()=>V?X(V):j(Error("Queue storage returned no result")),D.onabort=()=>j(W??D.error??Error("Queue storage transaction failed")),D.onerror=()=>{W??=D.error}})}}function L0(Z){if(!Z||Z.type!=="plannotator:queue"||typeof Z.key!=="string"||Z.key.length>2048||!/^(chatgpt|claude|gemini|fixture):/.test(Z.key))throw Error("Invalid queue conversation");if(typeof Z.clientId!=="string"||!/^[A-Za-z0-9:_-]{1,128}$/.test(Z.clientId))throw Error("Invalid queue client");if(!["read","enqueue","begin-edit","edit-heartbeat","cancel-edit","steer","edit","move","remove","pause","heartbeat","claim","attempt","ack","complete","release","review","retry"].includes(Z.action))throw Error("Unknown queue action");if(Z.id!==void 0&&(typeof Z.id!=="string"||!/^[A-Za-z0-9:_-]{1,128}$/.test(Z.id)))throw Error("Invalid queued message ID");if(Z.editToken!==void 0&&(typeof Z.editToken!=="string"||!/^[A-Za-z0-9:_-]{1,128}$/.test(Z.editToken)))throw Error("Invalid queue edit token");if(["begin-edit","edit-heartbeat","cancel-edit"].includes(Z.action)&&!Z.editToken)throw Error("Missing queue edit token");if(Z.afterUserMessageId!==void 0&&(typeof Z.afterUserMessageId!=="string"||!Z.afterUserMessageId||Z.afterUserMessageId.length>256))throw Error("Invalid queue transcript anchor");if(["enqueue","edit"].includes(Z.action)&&(typeof Z.text!=="string"||!Z.text.trim()||Z.text.length>200000))throw Error(`Queued messages must contain 1–${200000 .toLocaleString()} characters`)}function k0(Z,$){for(let J of Z.items){if(J.status==="editing"&&(J.leaseUntil??0)<=$)z(J),Z.paused=!0;if(J.status==="claimed"&&(J.leaseUntil??0)<=$)z(J);if(J.status==="sending"&&(J.attemptedAt??0)+30000<=$)J.status="review",J.reason="Delivery could not be confirmed. Check the chat before retrying to avoid a duplicate.",delete J.leaseUntil}TZ(Z,$)}function TZ(Z,$){if(!Z.busyLeases){if((Z.busyUntil??0)>$)Z.legacyBusyUntil=Math.max(Z.legacyBusyUntil??0,Z.busyUntil);Z.busyLeases=[]}if(Z.busyLeases=Z.busyLeases.filter((Y)=>Y.until>$),(Z.legacyBusyUntil??0)<=$)delete Z.legacyBusyUntil;let J=Z.busyLeases.reduce((Y,X)=>Math.max(Y,X.until),Z.legacyBusyUntil??0);if(J>$)Z.busyUntil=J;else delete Z.busyUntil}function I0(Z,$,J,Y){let X=Z.items.find((G)=>G.id===$.id),j=()=>{if(!X)throw Error("This queued message is no longer available");return X},D=(G)=>{let V=j();if(V.status!==G||V.owner!==J)throw Error("This queued message is being handled by another tab or has changed");return V},U=()=>{let G=D("editing");if(G.editToken!==$.editToken)throw Error("This edit session has changed; reopen the queued message");return G};switch($.action){case"read":return;case"heartbeat":{if($.busy===!0||$.busy===!1){let G=Z.busyLeases.find((V)=>V.owner===J);if(Z.busyLeases=Z.busyLeases.filter((V)=>V.owner!==J),$.busy)Z.busyLeases.push({owner:J,until:Math.max(G?.until??0,Y+3000)});TZ(Z,Y)}return}case"enqueue":if(!$.id)throw Error("Missing queued message ID");if(X||Z.retiredIds?.includes($.id))return;if(Z.items.length>=100)throw Error("Queue is full (100 messages)");if(Z.items.length===0)if($.afterUserMessageId)Z.lastCompletedUserMessageId=$.afterUserMessageId;else delete Z.lastCompletedUserMessageId;Z.items.push({id:$.id,text:$.text,createdAt:Y,status:"queued"});return;case"pause":if(typeof $.paused!=="boolean")throw Error("Invalid queue pause state");if(Z.paused=$.paused,Z.paused){for(let G of Z.items)if(G.status==="claimed")z(G)}return;case"begin-edit":{let G=j();if(G.status==="editing"&&G.owner===J&&G.editToken===$.editToken){G.leaseUntil=Y+30000;return}if(G.status!=="queued")throw Error("Only queued messages can be edited");G.status="editing",G.owner=J,G.editToken=$.editToken,G.leaseUntil=Y+30000;return}case"edit-heartbeat":{U().leaseUntil=Y+30000;return}case"cancel-edit":{z(U());return}case"edit":{if(!X&&$.editToken&&Z.editReceipts?.some((V)=>V.id===$.id&&V.editToken===$.editToken&&V.text===$.text))return;let G=j();if(G.status!=="editing"&&$.editToken&&G.lastEditToken===$.editToken&&G.text===$.text)return;if(G.status==="editing"){U(),G.text=$.text,G.lastEditToken=$.editToken,z(G);return}if(G.status!=="queued")throw Error("Only queued messages can be edited");if($.editToken)throw Error("This edit session has expired or changed; reopen the queued message");G.text=$.text,delete G.lastEditToken;return}case"move":{let G=j();if(G.status!=="queued")throw Error("Only queued messages can be reordered");if(!Number.isInteger($.delta)||!$.delta||Math.abs($.delta)>100)throw Error("Invalid queue move");let V=Z.items.indexOf(G),W=Math.max(0,Math.min(Z.items.length-1,V+$.delta));if(Z.items.slice(Math.min(V,W),Math.max(V,W)+1).some((_)=>_.status!=="queued"))throw Error("Cannot move past a message that is already being sent");Z.items.splice(V,1),Z.items.splice(W,0,G);return}case"remove":{if(!X)return;if(X.status==="editing"){if(X.owner!==J)throw Error("Another tab is editing this queued message")}else if(!["queued","review"].includes(X.status))throw Error("Wait for this message's delivery status before removing it");JZ(Z,X);return}case"claim":{if(Z.lastCompletedUserMessageId&&$.afterUserMessageId!==Z.lastCompletedUserMessageId)return;if(Z.paused||(Z.busyUntil??0)>Y||Z.items.some((V)=>V.status!=="queued"))return;let G=Z.items[0];if(!G)return;return G.status="claimed",G.owner=J,G.leaseUntil=Y+1e4,G}case"steer":{let G=j();if(G.status!=="queued"||Z.items.some((W)=>!["queued","waiting"].includes(W.status)))throw Error("Wait for the active send or edit to finish before sending this message now");Z.items.splice(Z.items.indexOf(G),1);let V=Z.items.reduce((W,_,O)=>_.status==="waiting"?O:W,-1);return Z.items.splice(V+1,0,G),G.status="claimed",G.owner=J,G.leaseUntil=Y+1e4,G.sendNow=!0,G}case"attempt":{let G=D("claimed");if(G.sendNow){for(let V of Z.items.filter((W)=>W.status==="waiting"))JZ(Z,V);delete Z.lastCompletedUserMessageId}else if(Z.paused||(Z.busyUntil??0)>Y)throw Error("ChatGPT became busy or the queue was paused");G.status="sending",G.attemptedAt=Y,G.leaseUntil=Y+30000;return}case"ack":{let G=j();if(G.owner!==J||!["sending","review","waiting"].includes(G.status))throw Error("This message's delivery cannot be acknowledged by this tab");if(typeof $.userMessageId!=="string"||!$.userMessageId||$.userMessageId.length>256)throw Error("Missing confirmed ChatGPT message ID");if(G.status==="waiting"&&G.userMessageId!==$.userMessageId)throw Error("Conflicting ChatGPT message ID");G.status="waiting",G.userMessageId=$.userMessageId,delete G.leaseUntil,delete G.reason;return}case"complete":{if(!X)return;if(X.status!=="waiting")throw Error("Delivery must be confirmed before completing a queued message");if($.userMessageId!==void 0&&$.userMessageId!==X.userMessageId)throw Error("ChatGPT message ID does not match");Z.lastCompletedUserMessageId=X.userMessageId,JZ(Z,X);return}case"release":{if(!X)return;z(D("claimed"));return}case"review":{let G=j();if(G.owner!==J)throw Error("This send attempt belongs to another tab or has changed");if(G.status==="waiting")return;if(!["sending","review"].includes(G.status))throw Error("This message has not been sent yet");G.status="review",G.reason=typeof $.reason==="string"?$.reason.slice(0,1000):"Check whether this message was delivered before retrying.",delete G.leaseUntil;return}case"retry":{let G=j();if(G.status!=="review")throw Error("Only messages needing review can be retried");z(G);return}}}function z(Z){Z.status="queued",delete Z.owner,delete Z.leaseUntil,delete Z.attemptedAt,delete Z.userMessageId,delete Z.reason,delete Z.editToken,delete Z.sendNow}function JZ(Z,$){if($.lastEditToken)Z.editReceipts=[...Z.editReceipts??[],{id:$.id,editToken:$.lastEditToken,text:$.text}].slice(-20);Z.items.splice(Z.items.indexOf($),1),Z.retiredIds=[...Z.retiredIds??[],$.id].slice(-1000)}function Q(){return window.location.hostname==="claude.ai"?"claude":window.location.hostname==="gemini.google.com"?"gemini":"chatgpt"}var wZ={claude:["[data-cds='ChatComposer'] [data-testid='chat-input'][contenteditable='true']","[data-testid='chat-input'][contenteditable='true'][role='textbox']"],gemini:["input-area-v2 rich-textarea .ql-editor[contenteditable='true'][role='textbox']"]},bZ="[data-cds='ChatComposer'], input-area-v2",qZ="[data-testid='assistant-message'] :is([data-perf-reply-text], .standard-markdown)",fZ="model-response message-content .markdown";function GZ(){return Array.from(document.querySelectorAll(Q()==="claude"?qZ:fZ))}function hZ(Z){let $=2166136261;for(let J=0;J<Z.length;J++)$=Math.imul($^Z.charCodeAt(J),16777619);return($>>>0).toString(36)}function XZ(Z,$){if(Q()==="claude"){let X=Z.closest("[data-testid='transcript-row']"),j=X?.getAttribute("data-index"),D=X?.getAttribute("data-perf-row");if(!j||!/^\d+$/.test(j)||!["human","assistant"].includes(D??""))return null;return`claude:${D}:${j}:${hZ($.replace(/\s+/g," ").trim())}`}let J=Z.closest("user-query");if(J){let X=J.querySelector(".query-content[id^='user-query-content-']");if(!X)return null;let j=X.id.match(/^user-query-content-(\d+)$/)?.[1];if(!j){let D=Array.from(document.querySelectorAll("user-query .query-content[id]")),U=D.indexOf(X);for(let G=U-1;G>=0;G--){let V=D[G].id.match(/^user-query-content-(\d+)$/)?.[1];if(V){j=String(Number(V)+U-G);break}}if(!j&&U===0&&D.length===1)j="0"}if(j===void 0)return null;return`gemini:user:user-query-content-${j}:${hZ($.replace(/\s+/g," ").trim())}`}let Y=Z.closest(".conversation-container[id]");if(!Y?.id)return null;return`gemini:assistant:${Y.id}`}function S0(Z,$){let J=Array.from(Z.querySelectorAll(".query-text-line"));if(!J.length)return $(Z).replace(/\u00a0/g," ").trim();return J.map((Y)=>{if(Y.children.length===1&&Y.firstElementChild?.tagName==="BR"&&!Y.textContent)return"";let X=$(Y);return X.length>=2&&X.startsWith(" ")&&X.endsWith(" ")?X.slice(1,-1):X}).join(`
`).replace(/\u00a0/g," ")}function vZ(Z,$,J){let Y=Q(),X=Y==="claude"?"[data-testid='user-message']":"user-query .query-text",j=Y==="claude"?qZ:fZ,D=J==="user"?X:J==="assistant"?j:`${X}, ${j}`,U=[];for(let G of Array.from(document.querySelectorAll(D))){if(!Z(G))continue;let V=G.matches("[data-testid='user-message'], .query-text")?"user":"assistant",W=G.cloneNode(!0);W.querySelectorAll("button, [role='button'], script, style, .cdk-visually-hidden, .sr-only").forEach((M)=>M.remove());let _=Y==="gemini"&&V==="user"?S0(W,$):$(W).replace(/\u00a0/g," ").trim(),O=XZ(G,_);if(O&&_.trim()&&!U.some((M)=>M.id===O))U.push({id:O,text:_,role:V,element:G})}return U}function xZ(Z){let $=Q()==="claude"?"[data-testid='transcript-row'][data-perf-row-streaming='true'], [data-testid='assistant-message'][data-is-streaming='true'], [aria-label='Currently streaming message']":"model-response [aria-busy='true']";return Array.from(document.querySelectorAll($)).some(Z)}var yZ=new WeakMap;function pZ(Z,$){if(Q()==="gemini"){let X=Z.slice(7),j=[];for(let D of Array.from(document.querySelectorAll("model-response [jslog]"))){let U=D.getAttribute("jslog")?.match(/BardVeMetadataKey:([^;]+)/)?.[1];if(!U)continue;try{let G=JSON.parse(atob(U)),V=Array.isArray(G)&&Array.isArray(G[0])?G[0][1]:null;if(typeof V==="string"&&V.startsWith("c_"))j.push(V.slice(2))}catch{}}return j.length>0&&j.every((D)=>D===X)}let J=$.filter((X)=>X.role==="user").map((X)=>X.id).join("|"),Y=yZ.get(document);if(!Y)Y={key:Z,signature:J,stale:null},yZ.set(document,Y);else if(Y.key!==Z)Y.stale=Y.signature,Y.key=Z;if(Y.stale!==null){if(!J||J===Y.stale)return!1;Y.stale=null}return Y.signature=J,Array.from(document.querySelectorAll("a[aria-current='page'][href]")).some((X)=>{try{return new URL(X.href).pathname===window.location.pathname}catch{return!1}})}function gZ(Z,$){let J=Q(),Y=Z.element.closest(J==="claude"?"[data-testid='transcript-row']":"model-response");if(!Y)return!1;if(J==="claude"&&(Y.getAttribute("data-perf-row-streaming")!=="false"||Z.element.closest("[data-testid='assistant-message']")?.getAttribute("data-is-streaming")!=="false"))return!1;if(J==="gemini"&&(Z.element.getAttribute("aria-busy")!=="false"||!Y.querySelector(".response-footer.complete")))return!1;let X=Array.from(Y.querySelectorAll("button")).filter($).filter((j)=>!Z.element.contains(j)).map((j)=>j.getAttribute("aria-label")?.toLowerCase());return X.includes("copy")&&X.includes("good response")&&X.includes("bad response")}var T0=["[data-composer-input] [data-composer-markdown][contenteditable='true']","[data-composer-markdown][contenteditable='true'][role='textbox']","#prompt-textarea","[data-testid='prompt-textarea']","form[data-type='unified-composer'] textarea","form.group\\/composer textarea","form[data-type='unified-composer'] [contenteditable='true']","form.group\\/composer [contenteditable='true']"],jZ="[data-message-author-role='user'], [data-markdown-text-style='user-message'], [data-chatgpt-search-unit-key$=':user']",d="[data-message-author-role='assistant'], [data-markdown-text-style='assistant-message']",h0=`${jZ}, ${d}`,y0=/^(?:stop|pause)(?:$|[\s…])/i,mZ=/^(?:send|send message|send prompt)$/i,cZ=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,C=null;function F(Z){if(!(Z instanceof HTMLElement)||!Z.isConnected)return!1;for(let $=Z;$;$=$.parentElement){if($.hidden||$.getAttribute("aria-hidden")==="true")return!1;let J=window.getComputedStyle($);if(J.display==="none"||J.visibility==="hidden"||J.visibility==="collapse")return!1}return Z.getClientRects().length>0}function w(){let Z=Q();for(let $ of Z==="chatgpt"?T0:wZ[Z])for(let J of Array.from(document.querySelectorAll($))){if(!F(J)||J.closest("[data-plannotator-queue-root], #plannotator-chatgpt-root"))continue;if(J instanceof HTMLTextAreaElement){if(!J.disabled&&!J.readOnly)return J}else if(J.getAttribute("contenteditable")==="true"&&J.getAttribute("aria-disabled")!=="true")return J}return null}function i(Z=w()){if(!Z)return null;let $=Z.closest(`[data-composer-body], form, [data-composer-surface], section[aria-label*='composer' i], ${bZ}`);if($)return $;let J=Z.parentElement;for(let Y=0;J&&Y<6;Y++,J=J.parentElement){if(J===document.body||J.matches("main, [role='main']"))break;if(Array.from(J.querySelectorAll("button")).some((X)=>lZ(X)||o(X)))return J}return Z.parentElement}function o(Z){return Z.getAttribute("data-testid")==="stop-button"||y0.test((Z.getAttribute("aria-label")||Z.getAttribute("title")||"").trim())}function lZ(Z){if(o(Z))return!1;let $=(Z.getAttribute("aria-label")||Z.getAttribute("title")||"").trim();if($&&!mZ.test($))return!1;return Z.getAttribute("data-testid")==="send-button"||Z.id==="composer-submit-button"||mZ.test($)}function HZ(){let Z=i();if(!Z)return null;for(let $ of Array.from(Z.querySelectorAll("button")))if(F($)&&lZ($)&&!$.disabled&&$.getAttribute("aria-disabled")!=="true")return $;return null}function Z2(){let Z=(Y)=>{if(!F(Y)||Y.disabled||Y.getAttribute("aria-disabled")==="true"||!o(Y))return!1;let X=`${Y.getAttribute("aria-label")??""} ${Y.getAttribute("title")??""}`;return!/\b(?:audio|playback|recording|dictation|voice|music|read[ -]?aloud)\b/i.test(X)&&!Y.closest("[data-testid*='audio'], [data-testid*='voice'], [aria-label*='read aloud' i]")},$=i(),J=$&&Array.from($.querySelectorAll("button")).find(Z);if(J)return J;return Array.from(document.querySelectorAll("button[data-testid='stop-button']")).find(Z)??null}function a(Z){if(Z instanceof HTMLTextAreaElement)return Z.value;return y(Z).replace(/\u00a0/g," ")}function y(Z){let $="";for(let J of Array.from(Z.childNodes)){if(J.nodeType===3){$+=J.textContent??"";continue}if(!(J instanceof HTMLElement))continue;if(J.tagName==="BR"){$+=`
`;continue}let Y=/^(?:P|DIV|LI|PRE|BLOCKQUOTE|H[1-6])$/.test(J.tagName);if(Y&&$&&!$.endsWith(`
`))$+=`
`;if($+=y(J),Y&&J.nextSibling&&!$.endsWith(`
`))$+=`
`}return $}function uZ(Z,$){if(!Z.isConnected)return!1;if(Z instanceof HTMLTextAreaElement){if(Z.disabled||Z.readOnly)return!1;let J=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;if(!J)return!1;J.call(Z,$),Z.dispatchEvent(new Event("input",{bubbles:!0})),Z.dispatchEvent(new Event("change",{bubbles:!0}))}else{if(Z.getAttribute("contenteditable")!=="true"||Z.getAttribute("aria-disabled")==="true")return!1;Z.focus({preventScroll:!0});let J=window.getSelection();if(!J)return!1;let Y=document.createRange();Y.selectNodeContents(Z),J.removeAllRanges(),J.addRange(Y);let X=!1;try{X=document.execCommand("insertText",!1,$)}catch{}if(!X)Z.textContent=$,Z.dispatchEvent(new InputEvent("input",{bubbles:!0,composed:!0,data:$,inputType:"insertText"}))}return DZ(a(Z))===DZ($)}function dZ(){if(Q()!=="chatgpt")return xZ(F);return Array.from(document.querySelectorAll("main[aria-busy='true'], [role='main'][aria-busy='true'], [data-testid='conversation-loading'], [data-testid='conversation-loading-spinner'], [data-is-streaming='true'], [data-message-author-role='assistant'][aria-busy='true'], [data-markdown-text-style='assistant-message'][aria-busy='true']")).some(F)}function n(){let Z=i();if(Z&&Array.from(Z.querySelectorAll("button")).some(($)=>F($)&&o($)))return!0;if(Array.from(document.querySelectorAll("button[data-testid='stop-button']")).some(F))return!0;if(Array.from(document.querySelectorAll("[data-markdown-animated]")).some(($)=>F($)&&!$.closest("[data-chatgpt-selection-message-id], [data-message-id]")))return!0;return dZ()}function iZ(){let Z=i();if(!Z)return!1;if(Array.from(Z.querySelectorAll("input[type='file']")).some((J)=>(J.files?.length??0)>0))return!0;let $=Z.querySelectorAll("[data-file-id], [data-attachment-id], [data-testid='attachment'], [data-testid*='file-preview'], [data-testid*='attachment-preview'], [data-testid*='image-preview'], [data-test-id*='file-preview'], [data-test-id*='attachment-preview'], uploaded-file, file-preview, img[src^='blob:'], img[src^='data:']");if(Array.from($).some(F))return!0;return Array.from(Z.querySelectorAll("button")).some((J)=>{let Y=`${J.getAttribute("aria-label")??""} ${J.getAttribute("title")??""}`;return F(J)&&/\b(?:remove|delete)\b.*\b(?:attachment|file|image|upload)\b/i.test(Y)})}function oZ(Z){let $=Z.closest("[data-chatgpt-selection-message-id], [data-message-id]")||Z.querySelector("[data-chatgpt-selection-message-id], [data-message-id]"),J=$?.getAttribute("data-chatgpt-selection-message-id")||$?.getAttribute("data-message-id");if(J)return J;return Z.closest("[data-chatgpt-search-message-ids]")?.getAttribute("data-chatgpt-search-message-ids")?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]??null}function DZ(Z){return Z.replace(/\r\n/g,`
`).replace(/\u00a0/g," ").trim()}function aZ(Z){if(Q()!=="chatgpt")return vZ(F,y,Z);let $=[],J=new Set,Y=Z==="user"?jZ:Z==="assistant"?d:h0;for(let X of Array.from(document.querySelectorAll(Y))){if(!F(X))continue;let j=oZ(X);if(!j||J.has(j))continue;let D=X.matches(jZ)?"user":"assistant",G=(X.querySelector(D==="user"?"[data-user-message-bubble='true'], [data-markdown-text-style='user-message'], [data-chatgpt-selection-message-id], [data-message-author-role='user']":"[data-markdown-text-style='assistant-message']")??X).cloneNode(!0);G.querySelectorAll("button, [role='button'], script, style").forEach((W)=>W.remove());let V=DZ(y(G));if(!V)continue;J.add(j),$.push({id:j,text:V,role:D,element:X})}return $}function w0(){return aZ("user").map(({id:Z,text:$})=>({id:Z,text:$}))}function nZ(){return Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]")).filter(F).map((Z)=>Z.getAttribute("data-chatgpt-selection-conversation-id"))}function $2(Z,$){if(!Z.startsWith("chatgpt:")||YZ(window.location.href)!==Z)return!1;if(C&&C.routeKey!==Z)return!1;let J=w0()[0],Y=(D)=>D.replace(/\s+/g," ").trim();if(!J||!cZ.test(J.id)||!$.trim()||Y(J.text)!==Y($))return!1;let X=nZ(),j=X[0];if(!j?.startsWith("local-chatgpt:")||!cZ.test(j.slice(14))||X.some((D)=>D!==j))return!1;if(C&&(C.localId!==j||C.firstUserId!==J.id))return!1;return C={routeKey:Z,localId:j,firstUserId:J.id},!0}function J2(){C=null}function sZ(){let Z=YZ(window.location.href);if(!Z||!w()||Q()==="chatgpt"&&dZ())return null;let $=aZ();if(!$.length)return null;if(Q()!=="chatgpt")return pZ(Z,$)?$:null;if(Z.startsWith("chatgpt:")){let J=Z.slice(8),Y=nZ();if(!Y.length)return null;if(Y.some((X)=>X!==J)){if(!C||C.routeKey!==Z||Y.some((X)=>X!==C.localId)||!$.some((X)=>X.role==="user"&&X.id===C.firstUserId))return null}}return $}function Y2(){return sZ()!==null}function G2(Z){if(n())return!1;let $=sZ();if(!$)return!1;let J=$.findIndex((j)=>j.role==="user"&&(j.id===Z||Q()==="gemini"&&Z===`gemini:user:${j.element.closest(".conversation-container[id]")?.id}`));if(J<0)return!1;let Y;for(let j of $.slice(J+1)){if(j.role==="user")break;Y=j}if(!Y)return!1;if(Q()!=="chatgpt")return gZ(Y,F);let X=Y.element;for(let j=0;X&&j<8;j++,X=X.parentElement){if(X===document.body||X.matches("main, [role='main']"))break;if($.filter((V)=>X.contains(V.element)).some((V)=>V.role==="user"?V.id!==Z:V.id!==Y.id))break;let U=Array.from(X.querySelectorAll("button")).filter(F);if(U.some((V)=>/^(?:copy-turn-action-button|good-response-turn-action-button|bad-response-turn-action-button)$/.test(V.getAttribute("data-testid")??"")))return!0;let G=U.filter((V)=>!V.closest(d)).map((V)=>(V.getAttribute("aria-label")??"").trim().toLowerCase());if(G.includes("rate response")&&(G.includes("copy")||G.includes("copy response")))return!0}return!1}function VZ(){return Q()==="claude"?"Claude":Q()==="gemini"?"Gemini":"ChatGPT"}function UZ(Z){let $=Z instanceof HTMLElement?Z:Z?.parentElement;if(!$)return null;if(Q()!=="chatgpt")return GZ().find((J)=>J===$||J.contains($))??null;return $.closest("[data-message-author-role='assistant']")??$.closest("[data-markdown-text-style='assistant-message']")}function rZ(){if(Q()!=="chatgpt")return GZ();return[...new Set(Array.from(document.querySelectorAll(d)).map(UZ).filter((Z)=>Z!==null))]}function tZ(Z){if(Q()!=="chatgpt")return XZ(Z,y(Z));return oZ(Z)}var c="plannotator-chatgpt-root",eZ="plannotator-chatgpt-page-style",Z0="data-plannotator-message-id",b0="plannotator-chatgpt-notes:v1:",AZ="plannotator-notes",PZ="plannotator-note-active",q0=120,$0=48,WZ=260,t=14,f0=140,v0=4,x0=1400,p0=120,g0=400,m0=700;var RZ=!1,MZ="prod",c0="",H={notes:[],activeNoteId:null,selectionDraft:null,draftEditorOpen:!1,draftText:"",notesMenuOpen:!1,actionFeedback:"idle"},_Z=0,L=null,r=0,b=0,FZ=0,KZ=0,q=null,N=null,P=null,R=[],S=0,J0=0,f=null,BZ=null,s=null,EZ=0;if(window.top===window)l0();function l0(){if(document.getElementById(c))return;d0();let Z=i0();u0(),Y1(Z),G1(Z),document.addEventListener("selectionchange",()=>{if(_Z)return;_Z=window.requestAnimationFrame(()=>{_Z=0,t0(Z)})},!0),window.addEventListener("keydown",($)=>{let J=$.composedPath()[0],Y=J instanceof HTMLElement?J:null,X=(Y instanceof HTMLTextAreaElement||Y instanceof HTMLInputElement)&&Y.getRootNode()===Z.shadow;if(X)$.stopImmediatePropagation();let j=(Y instanceof HTMLTextAreaElement||Y instanceof HTMLInputElement)&&X&&Y.dataset.field==="draft";if($.shiftKey&&($.metaKey||$.ctrlKey)&&!$.altKey){let D=$.key.toLowerCase();if(D==="enter"){$.preventDefault(),CZ(Z);return}if(D==="i"){$.preventDefault(),CZ(Z);return}if(D==="c"){$.preventDefault(),navigator.clipboard.writeText(K0());return}if(D==="k"){$.preventDefault(),I(),NZ(),K(Z);return}}if(j&&$.key==="Enter"&&!$.shiftKey){$.preventDefault(),H.draftText=Y.value,Z1(),K(Z);return}if($.key!=="Escape")return;if(H.notesMenuOpen){H.notesMenuOpen=!1,K(Z);return}if(j){k(),K(Z);return}if(k(),H.activeNoteId)H.activeNoteId=null;K(Z)},!0),document.addEventListener("pointerdown",($)=>{if($.composedPath().includes(Z.host))return;if(!H.activeNoteId&&!H.selectionDraft&&!H.notesMenuOpen)return;k(),H.activeNoteId=null,H.notesMenuOpen=!1,p(Z)},!0),window.addEventListener("resize",()=>p(Z),{passive:!0}),window.addEventListener("scroll",()=>Y0(Z),{passive:!0}),document.addEventListener("scroll",()=>Y0(Z),{passive:!0,capture:!0}),window.addEventListener("wheel",()=>G0(Z),{passive:!0,capture:!0}),window.addEventListener("touchmove",()=>G0(Z),{passive:!0,capture:!0}),document.addEventListener("submit",()=>{QZ(Z,"submit")},!0),document.addEventListener("click",($)=>{if(!X1($.composedPath()))return;QZ(Z,"button")},!0),document.addEventListener("keydown",($)=>{if(!H1($))return;QZ(Z,"enter")},!0),window.addEventListener("pagehide",()=>{l({preserveExistingOnEmpty:!0})},{capture:!0}),K(Z),B0(Z)}function u0(){if(!RZ||!c0)return;let Z=globalThis.chrome?.runtime;if(!Z?.sendMessage)return;let $=Z.sendMessage.bind(Z);A("polling");let J=!1,Y=!1,X=0,j=()=>{let G=w(),V=document.getElementById(c)?.shadowRoot,W=document.getElementById("plannotator-message-queue"),_=W?.shadowRoot;return Boolean(G&&!a(G).trim()&&!n()&&!iZ()&&!H.draftEditorOpen&&!H.draftText.trim()&&!N&&H.actionFeedback!=="loading"&&!V?.querySelector("textarea")&&W?.getAttribute("data-reload-blocked")!=="true"&&!_?.querySelector("textarea, button[data-action='enqueue']:disabled"))},D=(G=420)=>{if(X)return;if(!j()){A("waiting-for-idle");return}A("page-reload-scheduled"),X=window.setTimeout(()=>{if(X=0,!j()){A("waiting-for-idle");return}A("page-reloading"),window.location.reload()},G)};Z.onMessage?.addListener?.((G,V,W)=>{if(G?.type==="plannotator:dev-can-reload"){W?.({ok:!0,safe:j()});return}if(G?.type!=="plannotator:dev-page-reload")return;Y=!0,A("page-reload-message"),D()});let U=async()=>{if(J||X)return;if(Y){D();return}J=!0;try{let G=await $({type:"plannotator:dev-version"});if(!G?.buildId||G.buildId==="booting"||G.buildId===MZ&&G.workerBuildId===MZ)return;if(G.workerBuildId===G.buildId){Y=!0,A(`worker-current:${G.buildId}`),D();return}if(!j()){A("waiting-for-idle");return}A(`build-change:${G.buildId}`);let V=await $({type:"plannotator:dev-reload",buildId:G.buildId});if(V?.ok&&V.scheduled===!1){A("waiting-for-other-tabs");return}if(V?.ok&&V.scheduled===!0)A(`reload-requested:${G.buildId}`)}catch(G){let V=G instanceof Error?G.message:String(G);if(/context invalidated/i.test(V))Y=!0,D()}finally{J=!1}};U(),window.setInterval(()=>{U()},m0)}function d0(){if(document.getElementById(eZ))return;let Z=document.createElement("style");Z.id=eZ,Z.textContent=`
    ::highlight(${AZ}) {
      background: rgba(251, 191, 36, 0.35);
      color: inherit;
    }

    ::highlight(${PZ}) {
      background: rgba(245, 158, 11, 0.62);
      color: inherit;
    }
  `,document.head.appendChild(Z)}function i0(){let Z=document.createElement("div");if(Z.id=c,RZ)Z.dataset.buildId=MZ,Z.dataset.reloadState="booted";document.body.appendChild(Z);let $=Z.attachShadow({mode:"open"});$.innerHTML=`
    <style>
      :host {
        all: initial;
      }

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
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: white;
        box-sizing: border-box;
        animation: notes-action-spin 720ms linear infinite;
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
  `;let J=$.getElementById("markers-layer"),Y=$.getElementById("popover-layer"),X=$.getElementById("actions-layer");if(!J||!Y||!X)throw Error("Plannotator extension failed to initialize its UI");let j={host:Z,shadow:$,markersLayer:J,popoverLayer:Y,actionsLayer:X};$.addEventListener("pointerdown",(U)=>{let G=U.target;if(G?.closest("[data-action='open-draft']")){U.preventDefault(),H.draftEditorOpen=!0,H.activeNoteId=null,K(j);return}if(G?.closest("[data-action='insert-notes']")){if(U.preventDefault(),H.notes.length===0||H.actionFeedback!=="idle")return;CZ(j);return}}),$.addEventListener("click",(U)=>{let G=U.target;if(!G)return;if(G.closest("[data-action='open-draft']"))return;if(G.closest("[data-action='insert-notes']"))return;if(G.closest("[data-action='toggle-notes-menu']")){if(H.notes.length===0)return;H.notesMenuOpen=!H.notesMenuOpen,K(j);return}let V=G.closest("[data-action='jump-note']");if(V?.dataset.noteId){W1(V.dataset.noteId,j);return}if(G.dataset.action==="delete-note"){let W=G.closest("[data-note-id]")?.dataset.noteId;if(!W)return;J1(W),K(j);return}return});let D=(U)=>{if(U.dataset.field==="draft")H.draftText=U.value;else{let G=U.closest("[data-note-id]")?.dataset.noteId;if(G)$1(G,{comment:U.value})}zZ(U)};$.addEventListener("input",(U)=>{let G=U.composedPath()[0];if(G instanceof HTMLTextAreaElement||G instanceof HTMLInputElement)D(G)});for(let U of["keypress","keyup","beforeinput","input","paste","copy","cut"])window.addEventListener(U,(G)=>{let V=G.composedPath()[0];if(!(V instanceof HTMLTextAreaElement||V instanceof HTMLInputElement)||V.getRootNode()!==$)return;if(G.stopImmediatePropagation(),U!=="input")return;D(V)},!0);return j}function K(Z){o0(),a0(Z),r0(Z),n0(Z),K1()}function o0(){let Z=!1;if(H.notes=H.notes.flatMap(($)=>{if(O1($.range))return[$];let J=F0($);if(!J)return[$];return Z=!0,[J]}),Z)T()}function a0(Z){Z.markersLayer.innerHTML=""}function n0(Z){let $=H.actionFeedback==="loading",J=H.actionFeedback==="inserted";if(H.notes.length===0&&!$&&!J){Z.actionsLayer.innerHTML="";return}let Y=u(),X=24;if(Y instanceof HTMLElement){let U=Y.getBoundingClientRect();if(U.top<window.innerHeight)X=E(window.innerHeight-U.top+18,24,180)}let j=H.notesMenuOpen&&H.notes.length>0?s0():"",D=H.notes.length>0?`
    <button
      class="notes-list-toggle${H.notesMenuOpen?" active":""}"
      data-action="toggle-notes-menu"
      type="button"
      title="Show notes"
      aria-label="Show notes"
      aria-expanded="${H.notesMenuOpen?"true":"false"}"
    >${H.notes.length}</button>
  `:"";Z.actionsLayer.innerHTML=`
    <div class="notes-toolbar" style="bottom:${X}px;">
      ${j}
      ${D}
    <button
      class="notes-action${$?" loading":""}${J?" success":""}"
      data-action="insert-notes"
      type="button"
      title="${$?"Inserting into":J?"Inserted into":"Insert notes into"} ${VZ()}"
      aria-label="${$?"Inserting into":J?"Inserted into":"Insert notes into"} ${VZ()}"
      data-state="${$?"loading":J?"success":"idle"}"
      ${$||J?"disabled":""}
    >
      ${$?'<span class="notes-action-spinner" aria-hidden="true"></span>':J?`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M6.55 11.64 2.91 8l1.06-1.06 2.58 2.58 5.48-5.48L13.09 5.1z"/>
      </svg>`:`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M2 8.75h7.19L6.47 11.47 7.53 12.53 12.06 8 7.53 3.47 6.47 4.53 9.19 7.25H2z"/>
      </svg>`}
    </button>
    </div>
  `}function s0(){return`
    <section class="notes-menu" aria-label="Saved notes">
      ${e().map((Z,$)=>`
        <button
          class="notes-menu-row${Z.id===H.activeNoteId?" active":""}"
          data-action="jump-note"
          data-note-id="${Z.id}"
          type="button"
          title="${OZ(Z.comment||Z.quote)}"
          aria-label="Jump to note ${$+1}"
        >
          <span class="notes-menu-index">${$+1}</span>
          <span class="notes-menu-text">
            <span class="notes-menu-comment">${OZ(D0(Z.comment||"Untitled note",80))}</span>
            <span class="notes-menu-quote">${OZ(D0(Z.quote,90))}</span>
          </span>
        </button>
      `).join("")}
    </section>
  `}function r0(Z){let $=H.selectionDraft;if(!$){v(),Z.popoverLayer.innerHTML="";return}if(!H.draftEditorOpen){v();let _=X0($.rect),O=Q1($.rect,_),M=E($.rect.top+$.rect.height/2-12,12,window.innerHeight-24-12);Z.popoverLayer.innerHTML=`
      <button
        class="selection-trigger"
        data-action="open-draft"
        type="button"
        aria-label="Add note"
        title="Add note"
        style="left:${O}px;top:${M}px;"
      >+</button>
    `;return}let J=_0($),Y=X0($.rect),X=$.rect,j=Z.popoverLayer.querySelector(".note-popover[data-draft-editor='true']"),D=j?.querySelector("textarea[data-field='draft']")??null,U=!1;if(!j||!D||j.dataset.draftKey!==J){if(v(),Z.popoverLayer.innerHTML=`
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
    `,j=Z.popoverLayer.querySelector(".note-popover"),D=j?.querySelector("textarea[data-field='draft']")??null,!j||!D)return;j.dataset.draftKey=J,D.value=H.draftText,U=!0}else if(D.value!==H.draftText){let _=Z.shadow.activeElement===D,O=D.selectionStart,M=D.selectionEnd;if(D.value=H.draftText,_){let h=D.value.length;D.setSelectionRange(Math.min(O,h),Math.min(M,h))}}j.dataset.side=Y,zZ(D),j.style.left="-9999px",j.style.top="-9999px";let G=j.offsetHeight||52,V=B1(Y,X),W=E(X.top+X.height/2-G/2,12,window.innerHeight-G-12);if(j.style.left=`${V}px`,j.style.top=`${W}px`,U)F1(Z,J,D)}function _0(Z){return JSON.stringify([Z.messageId,Z.startOffset,Z.endOffset,Z.quote])}function t0(Z){if(P1(Z))return;let $=e0();r+=1;let J=r;if(L)clearTimeout(L),L=null;if(!$){if(!H.draftEditorOpen||!H.selectionDraft)H.selectionDraft=null,H.draftEditorOpen=!1;K(Z);return}L=setTimeout(()=>{if(J!==r)return;let Y=H.selectionDraft?.messageId??null,X=$.messageId;if(Y!==X||H.selectionDraft?.quote!==$.quote)H.draftText="",H.draftEditorOpen=!1,H.activeNoteId=null;H.selectionDraft=$,K(Z)},f0)}function e0(){let Z=document.getSelection();if(!Z||Z.isCollapsed||Z.rangeCount===0)return null;let $=Z.getRangeAt(0);if(!$||$.collapsed)return null;let J=j0($.startContainer),Y=j0($.endContainer);if(!J||J!==Y)return null;if(O0($.commonAncestorContainer))return null;let X=B(Z.toString()).trim();if(!X)return null;let j=M1($)??$.getBoundingClientRect();if(!j.width&&!j.height)return null;let D=LZ(J),U=A1(J,$),G=ZZ(J);return{messageId:D,quote:X,range:M0($),messageExcerpt:B(G).slice(0,q0),contextBefore:B(G.slice(Math.max(0,U.start-$0),U.start)),contextAfter:B(G.slice(U.end,U.end+$0)),startOffset:U.start,endOffset:U.end,rect:j}}function Z1(){let Z=H.selectionDraft;if(!Z)return;let $=H.draftText.trim();if(!$){k();return}let J={id:crypto.randomUUID(),messageId:Z.messageId,messageExcerpt:Z.messageExcerpt,quote:Z.quote,comment:$,contextBefore:Z.contextBefore,contextAfter:Z.contextAfter,startOffset:Z.startOffset,endOffset:Z.endOffset,range:Z.range,createdAt:Date.now()};I(),H.notes.push(J),H.activeNoteId=null,k(),T()}function $1(Z,$){let J=H.notes.find((Y)=>Y.id===Z);if(!J)return;if($.comment!==void 0)J.comment=$.comment;T()}function J1(Z){let $=e().filter((J)=>J.id!==Z);if(H.notes=$,H.activeNoteId===Z)H.activeNoteId=$.at(-1)?.id??null;T()}function NZ(){H.notes=[],H.activeNoteId=null,H.notesMenuOpen=!1,R=[],m(),k();let Z=CSS.highlights;Z?.set(AZ,new Highlight),Z?.set(PZ,new Highlight),T()}function K0(){if(H.notes.length===0)return"Select assistant text and add at least one note.";return e().map((Z)=>[`user: ${W0(Z.comment)}`,`responding to AI selected text: ${W0(Z.quote)}`].join(`
`)).join(`

`).trim()}async function CZ(Z){if(H.notes.length===0||H.actionFeedback==="loading")return;let $=u();if(!$){console.warn("[Plannotator] Composer not found.");return}I(),H.actionFeedback="loading",K(Z),await g1();let J=K0();if(!U1($,J)){I(),K(Z);return}NZ(),l(),p1(Z),K(Z)}function Y1(Z){if(P=g(),J0)return;J0=window.setInterval(()=>{let $=g();if($===P)return;l({preserveExistingOnEmpty:!0}),m(),R=[],I(),k(),H.notes=[],H.activeNoteId=null,H.notesMenuOpen=!1,P=$,K(Z),B0(Z)},g0)}function G1(Z){if(BZ||!document.body)return;BZ=new MutationObserver(()=>{if(R.length>0)IZ(Z);if(H.notes.length>0)p(Z)}),BZ.observe(document.body,{childList:!0,subtree:!0,characterData:!0})}async function B0(Z){if(P=g(),R=R1(P),H.notes=[],H.activeNoteId=null,H.notesMenuOpen=!1,R.length===0){m(),K(Z);return}IZ(Z)}function T(){if(P??=g(),N)clearTimeout(N);N=window.setTimeout(()=>{N=null,l()},p0)}function l(Z={}){if(N)clearTimeout(N),N=null;if(P??=g(),!P)return;try{let $=N1();if($.length===0){if(!Z.preserveExistingOnEmpty)window.localStorage.removeItem(P);return}window.localStorage.setItem(P,JSON.stringify($))}catch{}}function QZ(Z,$){if(u()?.hasAttribute("data-plannotator-queued-send"))return;if(H.notes.length===0)return;if($==="enter"&&!j1())return;if(s)clearTimeout(s);s=window.setTimeout(()=>{s=null,I(),NZ(),l(),K(Z)},$==="button"?0:90)}function X1(Z){return Z.some(($)=>$ instanceof Element&&D1($))}function j1(){if(n())return!1;let Z=u(),$=Z?v1(V1(Z)):"";return Boolean($||HZ())}function D1(Z){let $=HZ();return Boolean($&&($===Z||$.contains(Z)))}function H1(Z){if(Z.key!=="Enter"||Z.shiftKey||Z.altKey||Z.isComposing)return!1;let $=Z.composedPath()[0],J=$ instanceof Element?$:null;if(!J||O0(J))return!1;let Y=u();if(!Y)return!1;return J===Y||Y.contains(J)}function u(){return w()}function V1(Z){return a(Z)}function U1(Z,$){let J=uZ(Z,$);if(J)Z.focus();return J}function W1(Z,$){let J=H.notes.find((Y)=>Y.id===Z);if(!J)return;H.activeNoteId=Z,H.notesMenuOpen=!1,EZ=Date.now()+900,K($),_1(J)}function _1(Z){let $=Q0(Z.range);if(!$)return;let J=$.getBoundingClientRect();if(J.width||J.height){let X=J.top-window.innerHeight*0.35;window.scrollBy({top:X,behavior:"smooth"});return}($.startContainer instanceof Element?$.startContainer:$.startContainer.parentElement)?.scrollIntoView({behavior:"smooth",block:"center"})}function Y0(Z){if(H.activeNoteId&&Date.now()>EZ)H.activeNoteId=null;p(Z)}function G0(Z){if(!H.activeNoteId)return;H.activeNoteId=null,EZ=0,p(Z)}function K1(){let Z=CSS.highlights;if(!Z)return;let $=H.notes.find((Y)=>Y.id===H.activeNoteId),J=H.notes.filter((Y)=>Y.id!==$?.id).map((Y)=>Y.range);Z.set(AZ,new Highlight(...J)),Z.set(PZ,$?new Highlight($.range):new Highlight)}function X0(Z){let $=Z.left;return window.innerWidth-Z.right>=$?"right":"left"}function B1(Z,$){if(Z==="right")return E($.right+t,12,window.innerWidth-WZ-12);return E($.left-WZ-t,12,window.innerWidth-WZ-12)}function Q1(Z,$){if($==="right")return E(Z.right+t,12,window.innerWidth-24-12);return E(Z.left-24-t,12,window.innerWidth-24-12)}function O1(Z){let $=Q0(Z);if(!$)return null;let J=$.getBoundingClientRect();if(!J.width&&!J.height)return null;return J}function M1(Z){return Array.from(Z.getClientRects()).filter((J)=>J.width||J.height).at(-1)??null}function Q0(Z){if(Z instanceof Range)return Z.cloneRange();try{let $=document.createRange();return $.setStart(Z.startContainer,Z.startOffset),$.setEnd(Z.endContainer,Z.endOffset),$}catch{return null}}function v(){if(FZ+=1,!b)return;window.cancelAnimationFrame(b),b=0}function F1(Z,$,J){v();let Y=FZ;b=window.requestAnimationFrame(()=>{if(b=0,Y!==FZ)return;let X=H.selectionDraft;if(!X||!H.draftEditorOpen||_0(X)!==$)return;if(Z.popoverLayer.querySelector("textarea[data-field='draft']")!==J||!J.isConnected)return;zZ(J),J.focus({preventScroll:!0});let D=J.value.length;J.setSelectionRange(D,D)})}function zZ(Z){if(!(Z instanceof HTMLTextAreaElement))return;let $=window.getComputedStyle(Z),J=parseFloat($.lineHeight)||18,Y=parseFloat($.paddingTop)+parseFloat($.paddingBottom),X=parseFloat($.borderTopWidth)+parseFloat($.borderBottomWidth),j=J*v0+Y+X;Z.style.height="0px";let D=Math.min(Z.scrollHeight,j);Z.style.height=`${D}px`,Z.style.overflowY=Z.scrollHeight>j?"auto":"hidden"}function p(Z){if(KZ)return;KZ=window.requestAnimationFrame(()=>{KZ=0,K(Z)})}function k(){if(v(),r+=1,L)clearTimeout(L),L=null;H.selectionDraft=null,H.draftEditorOpen=!1,H.draftText="",document.getSelection()?.removeAllRanges()}function e(){return[...H.notes].sort((Z,$)=>Z.createdAt-$.createdAt)}function j0(Z){return UZ(Z)}function LZ(Z){let $=Z.getAttribute(Z0);if(!$)$=C1(Z),Z.setAttribute(Z0,$);return $}function C1(Z){let $=tZ(Z);if($)return $;let Y=kZ().indexOf(Z),X=B(ZZ(Z)).slice(0,96);return`assistant-${Y}-${x1(X)}`}function kZ(){return rZ()}function O0(Z){let $=Z instanceof HTMLElement?Z:Z?.parentElement??null;if(!$)return!1;return Boolean($.closest(`#${c}`))}function M0(Z){try{return new StaticRange({startContainer:Z.startContainer,startOffset:Z.startOffset,endContainer:Z.endContainer,endOffset:Z.endOffset})}catch{return Z.cloneRange()}}function A1(Z,$){let J=document.createTreeWalker(Z,NodeFilter.SHOW_TEXT),Y=0,X=0,j=0;while(J.nextNode()){let D=J.currentNode,U=D.textContent?.length??0;if(D===$.startContainer)X=Y+$.startOffset;if(D===$.endContainer){j=Y+$.endOffset;break}Y+=U}if(j<X)j=X+$.toString().length;return{start:X,end:j}}function ZZ(Z){let $=document.createTreeWalker(Z,NodeFilter.SHOW_TEXT),J="";while($.nextNode())J+=$.currentNode.textContent??"";return J}function B(Z){return Z.replace(/\s+/g," ").trim()}function D0(Z,$){let J=B(Z);if(J.length<=$)return J;return`${J.slice(0,$-1)}...`}function E(Z,$,J){return Math.max($,Math.min(J,Z))}function OZ(Z){return Z.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function P1(Z){let $=Z.shadow.activeElement;return($ instanceof HTMLTextAreaElement||$ instanceof HTMLInputElement)&&$.dataset.field==="draft"}function g(){return`${b0}${window.location.origin}${window.location.pathname}`}function R1(Z){try{let $=window.localStorage.getItem(Z);if(!$)return[];let J=JSON.parse($);if(!Array.isArray(J))return[];return J.flatMap((Y)=>{if(!E1(Y))return[];return[Y]})}catch{return[]}}function E1(Z){if(!Z||typeof Z!=="object")return!1;let $=Z;return typeof $.id==="string"&&typeof $.messageId==="string"&&typeof $.messageExcerpt==="string"&&typeof $.quote==="string"&&typeof $.comment==="string"&&typeof $.contextBefore==="string"&&typeof $.contextAfter==="string"&&($.startOffset===void 0||typeof $.startOffset==="number")&&($.endOffset===void 0||typeof $.endOffset==="number")&&typeof $.createdAt==="number"}function N1(){return e().map((Z)=>({id:Z.id,messageId:Z.messageId,messageExcerpt:Z.messageExcerpt,quote:Z.quote,comment:Z.comment,contextBefore:Z.contextBefore,contextAfter:Z.contextAfter,startOffset:Z.startOffset,endOffset:Z.endOffset,createdAt:Z.createdAt}))}function IZ(Z){if(S)return;S=window.requestAnimationFrame(()=>{S=0,z1(Z)})}function z1(Z){if(R.length===0){m(),K(Z);return}let $=new Map(H.notes.map((X)=>[X.id,X])),J=[],Y=!1;for(let X of R){if($.has(X.id))continue;let j=F0(X);if(!j){J.push(X);continue}if($.set(j.id,j),!A0(X)||j.quote!==X.quote)Y=!0}if(H.notes=Array.from($.values()).sort((X,j)=>X.createdAt-j.createdAt),R=J,K(Z),Y)T();if(R.length>0)L1(Z);else m()}function L1(Z){if(f||!document.body)return;f=new MutationObserver(()=>{IZ(Z)}),f.observe(document.body,{childList:!0,subtree:!0,characterData:!0})}function m(){if(S)window.cancelAnimationFrame(S),S=0;f?.disconnect(),f=null}function F0(Z){let $=k1(Z);if(!$)return null;let J=S1($,Z);if(!J)return null;return{...Z,messageId:LZ($),quote:J.quote,startOffset:J.startOffset,endOffset:J.endOffset,range:M0(J.range)}}function k1(Z){let $=I1(Z.messageId);if($)return $;let J=B(Z.messageExcerpt),Y=null,X=-1;for(let j of kZ()){let D=B(ZZ(j)),U=0;if(J&&D.includes(J))U+=J.length*2;if(Z.quote&&D.includes(B(Z.quote)))U+=Math.min(B(Z.quote).length,240);if(Z.contextBefore&&D.includes(B(Z.contextBefore)))U+=Z.contextBefore.length;if(Z.contextAfter&&D.includes(B(Z.contextAfter)))U+=Z.contextAfter.length;if(U>X)X=U,Y=j}return Y}function I1(Z){for(let $ of kZ())if(LZ($)===Z)return $;return null}function S1(Z,$){let J=ZZ(Z);if(!J)return null;if(A0($)){let j=U0(Z,$.startOffset,$.endOffset);if(j&&T1(j,$.quote))return{range:j,quote:B(j.toString())||$.quote,startOffset:$.startOffset,endOffset:$.endOffset}}let Y=h1(J,$);if(!Y)return null;let X=U0(Z,Y.start,Y.end);if(!X)return null;return{range:X,quote:B(X.toString())||$.quote,startOffset:Y.start,endOffset:Y.end}}function T1(Z,$){let J=x(Z.toString()),Y=x($);return Boolean(J)&&J===Y}function h1(Z,$){let J=B($.quote);if(!J)return null;let Y=J.split(" ").filter(Boolean),X=q1(Z);if(!X.text)return null;let j={contextBefore:B($.contextBefore),contextAfter:B($.contextAfter)},D=H0(X.text,J,Y,j," ");if(D)return V0(X,Z.length,D.start,D.end);let U=f1(Z),G=x($.quote);if(!U.text||!G)return null;let V=H0(U.text,G,Y,{contextBefore:x($.contextBefore),contextAfter:x($.contextAfter)},"");if(!V)return null;return V0(U,Z.length,V.start,V.end)}function H0(Z,$,J,Y,X){let j=null,D=0;while(D<Z.length){let U=Z.indexOf($,D);if(U===-1)break;let G=U+$.length,V=C0(Z,U,G,Y);if(!j||V>j.score)j={start:U,end:G,score:V};D=U+Math.max(1,$.length)}if(j)return j;return y1(Z,J,Y,X)}function C0(Z,$,J,Y){let X=B(Y.contextBefore),j=B(Y.contextAfter),D=Z.slice(Math.max(0,$-X.length),$),U=Z.slice(J,J+j.length);return w1(D,X)*2+b1(U,j)*2}function y1(Z,$,J,Y){if($.length===0)return null;let X=Math.min($.length,14),j=Math.min(X,3),D=null;for(let U=X;U>=j;U-=1){for(let G=0;G+U<=$.length;G+=1){let V=$.slice(G,G+U).join(Y),W=0;while(W<Z.length){let _=Z.indexOf(V,W);if(_===-1)break;let O=_+V.length,M=C0(Z,_,O,J)+V.length*4-G;if(!D||M>D.score)D={start:_,end:O,score:M};W=_+Math.max(1,V.length)}}if(D)return D}return null}function w1(Z,$){let J=0,Y=Z.length-1,X=$.length-1;while(Y>=0&&X>=0){if(Z[Y]!==$[X])break;J+=1,Y-=1,X-=1}return J}function b1(Z,$){let J=0,Y=Math.min(Z.length,$.length);while(J<Y){if(Z[J]!==$[J])break;J+=1}return J}function q1(Z){let $="",J=[],Y=!1,X=!1;for(let j=0;j<Z.length;j+=1){let D=Z[j];if(/\s/.test(D)){if(!Y||X)continue;$+=" ",J.push(j),X=!0;continue}$+=D,J.push(j),Y=!0,X=!1}if($.endsWith(" "))$=$.slice(0,-1),J.pop();return{text:$,rawByNormalized:J}}function f1(Z){let $="",J=[];for(let Y=0;Y<Z.length;Y+=1){let X=Z[Y];if(/\s/.test(X))continue;$+=X,J.push(Y)}return{text:$,rawByNormalized:J}}function V0(Z,$,J,Y){let X=Z.rawByNormalized[J],j=Y<Z.rawByNormalized.length?Z.rawByNormalized[Y]:$;if(typeof X!=="number")return null;return{start:X,end:Math.max(X+1,j)}}function U0(Z,$,J){if(J<=$)return null;let Y=document.createTreeWalker(Z,NodeFilter.SHOW_TEXT),X=0,j=null,D=null,U=0,G=0,V=null;while(Y.nextNode()){let _=Y.currentNode,O=_.textContent?.length??0,M=X+O;if(V=_,!j&&$<=M)j=_,U=E($-X,0,O);if(!D&&J<=M){D=_,G=E(J-X,0,O);break}X=M}if(!j)return null;if(!D){if(!V)return null;D=V,G=V.textContent?.length??0}if(j===D&&G<=U)return null;let W=document.createRange();return W.setStart(j,U),W.setEnd(D,G),W.collapsed?null:W}function A0(Z){return typeof Z.startOffset==="number"&&typeof Z.endOffset==="number"&&Z.endOffset>Z.startOffset}function W0(Z){return JSON.stringify(B(Z))}function v1(Z){return Z.replace(/\s+/g,"")}function x(Z){return Z.replace(/\s+/g,"")}function x1(Z){let $=5381;for(let J=0;J<Z.length;J+=1)$=($<<5)+$^Z.charCodeAt(J);return Math.abs($).toString(36)}function A(Z){if(!RZ)return;let $=document.getElementById(c);if($)$.dataset.reloadState=Z}function I(){if(H.actionFeedback="idle",q)clearTimeout(q),q=null}function p1(Z){I(),H.actionFeedback="inserted",q=window.setTimeout(()=>{H.actionFeedback="idle",q=null,K(Z)},x0)}function g1(){return new Promise((Z)=>window.requestAnimationFrame(()=>Z()))}})();

//# debugId=7B0FFF6A3D908AB164756E2164756E21
//# sourceMappingURL=content.js.map
