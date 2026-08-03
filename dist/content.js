var _={notes:[],activeNoteId:null,selectionDraft:null,draftEditorOpen:!1,draftText:"",notesMenuOpen:!1,actionFeedback:"idle"},u=0,q=null,x=0,I=0,d=0,c=0,L=null,B=null,Q=null,R=[],F=0,UG=0,N=null,l=null,v=null,o=0;if(window.top===window)OG();function OG(){if(document.getElementById("plannotator-chatgpt-root"))return;BG();let G=WG();qG(),TG(G),hG(G),document.addEventListener("selectionchange",()=>{if(u)return;u=window.requestAnimationFrame(()=>{u=0,NG(G)})},!0),document.addEventListener("keydown",(U)=>{let V=U.composedPath()[0],Z=V instanceof HTMLElement?V:null,$=(Z instanceof HTMLTextAreaElement||Z instanceof HTMLInputElement)&&Z.dataset.field==="draft";if(U.shiftKey&&(U.metaKey||U.ctrlKey)&&!U.altKey){let X=U.key.toLowerCase();if(X==="enter"){U.preventDefault(),r(G);return}if(X==="i"){U.preventDefault(),r(G);return}if(X==="c"){U.preventDefault(),navigator.clipboard.writeText(DG());return}if(X==="k"){U.preventDefault(),b(),a(),A(G);return}}if($&&U.key==="Enter"&&!U.shiftKey){U.preventDefault(),zG(),A(G);return}if(U.key!=="Escape")return;if(_.notesMenuOpen){_.notesMenuOpen=!1,A(G);return}if($){W(),A(G);return}if(W(),_.activeNoteId)_.activeNoteId=null;A(G)},!0),document.addEventListener("pointerdown",(U)=>{if(U.composedPath().includes(G.host))return;if(!_.activeNoteId&&!_.selectionDraft&&!_.notesMenuOpen)return;W(),_.activeNoteId=null,_.notesMenuOpen=!1,y(G)},!0),window.addEventListener("resize",()=>y(G),{passive:!0}),window.addEventListener("scroll",()=>VG(G),{passive:!0}),document.addEventListener("scroll",()=>VG(G),{passive:!0,capture:!0}),window.addEventListener("wheel",()=>ZG(G),{passive:!0,capture:!0}),window.addEventListener("touchmove",()=>ZG(G),{passive:!0,capture:!0}),document.addEventListener("submit",()=>{s(G,"submit")},!0),document.addEventListener("click",(U)=>{if(!vG(U.composedPath()))return;s(G,"button")},!0),document.addEventListener("keydown",(U)=>{if(!pG(U))return;s(G,"enter")},!0),window.addEventListener("pagehide",()=>{h({preserveExistingOnEmpty:!0})},{capture:!0}),A(G),EG(G)}function qG(){return}function BG(){if(document.getElementById("plannotator-chatgpt-page-style"))return;let G=document.createElement("style");G.id="plannotator-chatgpt-page-style",G.textContent=`
    ::highlight(plannotator-notes) {
      background: rgba(251, 191, 36, 0.35);
      color: inherit;
    }

    ::highlight(plannotator-note-active) {
      background: rgba(245, 158, 11, 0.62);
      color: inherit;
    }
  `,document.head.appendChild(G)}function WG(){let G=document.createElement("div");G.id="plannotator-chatgpt-root",document.body.appendChild(G);let U=G.attachShadow({mode:"open"});U.innerHTML=`
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
  `;let V=U.getElementById("markers-layer"),Z=U.getElementById("popover-layer"),$=U.getElementById("actions-layer");if(!V||!Z||!$)throw Error("Plannotator extension failed to initialize its UI");let X={host:G,shadow:U,markersLayer:V,popoverLayer:Z,actionsLayer:$};return U.addEventListener("pointerdown",(J)=>{let Y=J.target;if(Y?.closest("[data-action='open-draft']")){J.preventDefault(),_.draftEditorOpen=!0,_.activeNoteId=null,A(X);return}if(Y?.closest("[data-action='insert-notes']")){if(J.preventDefault(),_.notes.length===0||_.actionFeedback!=="idle")return;r(X);return}}),U.addEventListener("click",(J)=>{let Y=J.target;if(!Y)return;if(Y.closest("[data-action='open-draft']"))return;if(Y.closest("[data-action='insert-notes']"))return;if(Y.closest("[data-action='toggle-notes-menu']")){if(_.notes.length===0)return;_.notesMenuOpen=!_.notesMenuOpen,A(X);return}let j=Y.closest("[data-action='jump-note']");if(j?.dataset.noteId){uG(j.dataset.noteId,X);return}if(Y.dataset.action==="delete-note"){let C=Y.closest("[data-note-id]")?.dataset.noteId;if(!C)return;wG(C),A(X);return}return}),U.addEventListener("input",(J)=>{let Y=J.target;if(!Y)return;if(Y.dataset.field==="draft"){_.draftText=Y.value,f(Y);return}let j=Y.closest("[data-note-id]")?.dataset.noteId;if(!j)return;yG(j,{comment:Y.value}),f(Y)}),X}function A(G){FG(),SG(G),LG(G),bG(G),lG()}function FG(){let G=!1;if(_.notes=_.notes.flatMap((U)=>{if(dG(U.range))return[U];let V=QG(U);if(!V)return[U];return G=!0,[V]}),G)S()}function SG(G){G.markersLayer.innerHTML=""}function bG(G){let U=_.actionFeedback==="loading",V=_.actionFeedback==="inserted";if(_.notes.length===0&&!U&&!V){G.actionsLayer.innerHTML="";return}let Z=p(),$=24;if(Z instanceof HTMLElement){let Y=Z.getBoundingClientRect();if(Y.top<window.innerHeight)$=M(window.innerHeight-Y.top+18,24,180)}let X=_.notesMenuOpen&&_.notes.length>0?IG():"",J=_.notes.length>0?`
    <button
      class="notes-list-toggle${_.notesMenuOpen?" active":""}"
      data-action="toggle-notes-menu"
      type="button"
      title="Show notes"
      aria-label="Show notes"
      aria-expanded="${_.notesMenuOpen?"true":"false"}"
    >${_.notes.length}</button>
  `:"";G.actionsLayer.innerHTML=`
    <div class="notes-toolbar" style="bottom:${$}px;">
      ${X}
      ${J}
    <button
      class="notes-action${U?" loading":""}${V?" success":""}"
      data-action="insert-notes"
      type="button"
      title="${U?"Inserting into ChatGPT":V?"Inserted into ChatGPT":"Insert notes into ChatGPT"}"
      aria-label="${U?"Inserting into ChatGPT":V?"Inserted into ChatGPT":"Insert notes into ChatGPT"}"
      data-state="${U?"loading":V?"success":"idle"}"
      ${U||V?"disabled":""}
    >
      ${U?'<span class="notes-action-spinner" aria-hidden="true"></span>':V?`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M6.55 11.64 2.91 8l1.06-1.06 2.58 2.58 5.48-5.48L13.09 5.1z"/>
      </svg>`:`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M2 8.75h7.19L6.47 11.47 7.53 12.53 12.06 8 7.53 3.47 6.47 4.53 9.19 7.25H2z"/>
      </svg>`}
    </button>
    </div>
  `}function IG(){return`
    <section class="notes-menu" aria-label="Saved notes">
      ${m().map((G,U)=>`
        <button
          class="notes-menu-row${G.id===_.activeNoteId?" active":""}"
          data-action="jump-note"
          data-note-id="${G.id}"
          type="button"
          title="${i(G.comment||G.quote)}"
          aria-label="Jump to note ${U+1}"
        >
          <span class="notes-menu-index">${U+1}</span>
          <span class="notes-menu-text">
            <span class="notes-menu-comment">${i(XG(G.comment||"Untitled note",80))}</span>
            <span class="notes-menu-quote">${i(XG(G.quote,90))}</span>
          </span>
        </button>
      `).join("")}
    </section>
  `}function LG(G){let U=_.selectionDraft;if(!U){k(),G.popoverLayer.innerHTML="";return}if(!_.draftEditorOpen){k();let E=_G(U.rect),K=iG(U.rect,E),P=M(U.rect.top+U.rect.height/2-12,12,window.innerHeight-24-12);G.popoverLayer.innerHTML=`
      <button
        class="selection-trigger"
        data-action="open-draft"
        type="button"
        aria-label="Add note"
        title="Add note"
        style="left:${K}px;top:${P}px;"
      >+</button>
    `;return}let V=AG(U),Z=_G(U.rect),$=U.rect,X=G.popoverLayer.querySelector(".note-popover[data-draft-editor='true']"),J=X?.querySelector("textarea[data-field='draft']")??null,Y=!1;if(!X||!J||X.dataset.draftKey!==V){if(k(),G.popoverLayer.innerHTML=`
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
    `,X=G.popoverLayer.querySelector(".note-popover"),J=X?.querySelector("textarea[data-field='draft']")??null,!X||!J)return;X.dataset.draftKey=V,J.value=_.draftText,Y=!0}else if(J.value!==_.draftText){let E=G.shadow.activeElement===J,K=J.selectionStart,P=J.selectionEnd;if(J.value=_.draftText,E){let GG=J.value.length;J.setSelectionRange(Math.min(K,GG),Math.min(P,GG))}}X.dataset.side=Z,f(J),X.style.left="-9999px",X.style.top="-9999px";let j=X.offsetHeight||52,C=sG(Z,$),H=M($.top+$.height/2-j/2,12,window.innerHeight-j-12);if(X.style.left=`${C}px`,X.style.top=`${H}px`,Y)oG(G,V,J)}function AG(G){return JSON.stringify([G.messageId,G.startOffset,G.endOffset,G.quote])}function NG(G){if(eG(G))return;let U=kG();x+=1;let V=x;if(q)clearTimeout(q),q=null;if(!U){if(!_.draftEditorOpen||!_.selectionDraft)_.selectionDraft=null,_.draftEditorOpen=!1;A(G);return}q=setTimeout(()=>{if(V!==x)return;let Z=_.selectionDraft?.messageId??null,$=U.messageId;if(Z!==$||_.selectionDraft?.quote!==U.quote)_.draftText="",_.draftEditorOpen=!1,_.activeNoteId=null;_.selectionDraft=U,A(G)},140)}function kG(){let G=document.getSelection();if(!G||G.isCollapsed||G.rangeCount===0)return null;let U=G.getRangeAt(0);if(!U||U.collapsed)return null;let V=$G(U.startContainer),Z=$G(U.endContainer);if(!V||V!==Z)return null;if(KG(U.commonAncestorContainer))return null;let $=D(G.toString()).trim();if(!$)return null;let X=rG(U)??U.getBoundingClientRect();if(!X.width&&!X.height)return null;let J=n(V),Y=nG(V,U),j=g(V);return{messageId:J,quote:$,range:PG(U),messageExcerpt:D(j).slice(0,120),contextBefore:D(j.slice(Math.max(0,Y.start-48),Y.start)),contextAfter:D(j.slice(Y.end,Y.end+48)),startOffset:Y.start,endOffset:Y.end,rect:X}}function zG(){let G=_.selectionDraft;if(!G)return;let U=_.draftText.trim();if(!U){W();return}let V={id:crypto.randomUUID(),messageId:G.messageId,messageExcerpt:G.messageExcerpt,quote:G.quote,comment:U,contextBefore:G.contextBefore,contextAfter:G.contextAfter,startOffset:G.startOffset,endOffset:G.endOffset,range:G.range,createdAt:Date.now()};b(),_.notes.push(V),_.activeNoteId=null,W(),S()}function yG(G,U){let V=_.notes.find((Z)=>Z.id===G);if(!V)return;if(U.comment!==void 0)V.comment=U.comment;S()}function wG(G){let U=m().filter((V)=>V.id!==G);if(_.notes=U,_.activeNoteId===G)_.activeNoteId=U.at(-1)?.id??null;S()}function a(){_.notes=[],_.activeNoteId=null,_.notesMenuOpen=!1,R=[],T(),W();let G=CSS.highlights;G?.set("plannotator-notes",new Highlight),G?.set("plannotator-note-active",new Highlight),S()}function DG(){if(_.notes.length===0)return"Select assistant text and add at least one note.";return m().map((G)=>[`user: ${CG(G.comment)}`,`responding to AI selected text: ${CG(G.quote)}`].join(`
`)).join(`

`).trim()}async function r(G){if(_.notes.length===0||_.actionFeedback==="loading")return;let U=p();if(!U){console.warn("[Plannotator] Composer not found.");return}b(),_.actionFeedback="loading",A(G),await MU();let V=DG();a(),h(),gG(U,V),RU(G),A(G)}function TG(G){if(Q=w(),UG)return;UG=window.setInterval(()=>{let U=w();if(U===Q)return;h({preserveExistingOnEmpty:!0}),T(),R=[],b(),W(),_.notes=[],_.activeNoteId=null,_.notesMenuOpen=!1,Q=U,A(G),EG(G)},400)}function hG(G){if(l||!document.body)return;l=new MutationObserver(()=>{if(R.length>0)e(G);if(_.notes.length>0)y(G)}),l.observe(document.body,{childList:!0,subtree:!0,characterData:!0})}async function EG(G){if(Q=w(),R=GU(Q),_.notes=[],_.activeNoteId=null,_.notesMenuOpen=!1,R.length===0){T(),A(G);return}e(G)}function S(){if(Q??=w(),B)clearTimeout(B);B=window.setTimeout(()=>{B=null,h()},120)}function h(G={}){if(B)clearTimeout(B),B=null;if(Q??=w(),!Q)return;try{let U=VU();if(U.length===0){if(!G.preserveExistingOnEmpty)window.localStorage.removeItem(Q);return}window.localStorage.setItem(Q,JSON.stringify(U))}catch{}}function s(G,U){if(_.notes.length===0)return;if(U==="enter"&&!xG())return;if(v)clearTimeout(v);v=window.setTimeout(()=>{v=null,b(),a(),h(),A(G)},U==="button"?0:90)}function vG(G){return G.some((U)=>U instanceof Element&&fG(U))}function xG(){let G=p();if(G?KU(mG(G)):"")return!0;let V=document.querySelector(["#composer-submit-button","#send-button","[data-testid='send-button']","button[aria-label='Send prompt']","button[aria-label='Send message']","button[aria-label='Send']"].join(","));if(!V)return!1;let Z=V.getAttribute("aria-disabled");return!(V instanceof HTMLButtonElement?V.disabled:!1)&&Z!=="true"}function fG(G){return Boolean(G.closest(["#composer-submit-button","#send-button","[data-testid='send-button']","button[aria-label='Send prompt']","button[aria-label='Send message']","button[aria-label='Send']","button[class*='send']"].join(",")))}function pG(G){if(G.key!=="Enter"||G.shiftKey||G.altKey||G.isComposing)return!1;let U=G.composedPath()[0],V=U instanceof Element?U:null;if(!V||KG(V))return!1;let Z=p();if(!Z)return!1;if(V===Z)return!0;if(Z instanceof HTMLElement&&Z.contains(V))return!0;return Boolean(V.closest(["#prompt-textarea","[data-testid='prompt-textarea']","form[data-type='unified-composer']","form.group\\/composer"].join(",")))}function p(){let G=["form[data-type='unified-composer'] #prompt-textarea","form.group\\/composer #prompt-textarea","[data-composer-surface='true'] #prompt-textarea","#prompt-textarea","[data-testid='prompt-textarea']","div[contenteditable='true'][id='prompt-textarea']","div[contenteditable='true'][data-testid='prompt-textarea']","form[data-type='unified-composer'] textarea","form.group\\/composer textarea","form[data-type='unified-composer'] div[contenteditable='true']","form.group\\/composer div[contenteditable='true']"];for(let U of G){let V=document.querySelector(U);if(V instanceof HTMLTextAreaElement||V instanceof HTMLInputElement)return V;if(V instanceof HTMLElement&&V.isContentEditable)return V}return null}function mG(G){if(G instanceof HTMLTextAreaElement||G instanceof HTMLInputElement)return G.value;return G.textContent??""}function gG(G,U){if(G instanceof HTMLTextAreaElement||G instanceof HTMLInputElement){let Z=Object.getPrototypeOf(G);Object.getOwnPropertyDescriptor(Z,"value")?.set?.call(G,U),G.dispatchEvent(new Event("input",{bubbles:!0})),G.dispatchEvent(new Event("change",{bubbles:!0})),G.focus();return}if(G.focus(),tG(G),!document.execCommand("insertText",!1,U))G.textContent=U,G.dispatchEvent(new InputEvent("input",{bubbles:!0,cancelable:!0,data:U,inputType:"insertText"}))}function uG(G,U){let V=_.notes.find((Z)=>Z.id===G);if(!V)return;_.activeNoteId=G,_.notesMenuOpen=!1,o=Date.now()+900,A(U),cG(V)}function cG(G){let U=HG(G.range);if(!U)return;let V=U.getBoundingClientRect();if(V.width||V.height){let $=V.top-window.innerHeight*0.35;window.scrollBy({top:$,behavior:"smooth"});return}(U.startContainer instanceof Element?U.startContainer:U.startContainer.parentElement)?.scrollIntoView({behavior:"smooth",block:"center"})}function VG(G){if(_.activeNoteId&&Date.now()>o)_.activeNoteId=null;y(G)}function ZG(G){if(!_.activeNoteId)return;_.activeNoteId=null,o=0,y(G)}function lG(){let G=CSS.highlights;if(!G)return;let U=_.notes.find((Z)=>Z.id===_.activeNoteId),V=_.notes.filter((Z)=>Z.id!==U?.id).map((Z)=>Z.range);G.set("plannotator-notes",new Highlight(...V)),G.set("plannotator-note-active",U?new Highlight(U.range):new Highlight)}function _G(G){let U=G.left;return window.innerWidth-G.right>=U?"right":"left"}function sG(G,U){if(G==="right")return M(U.right+14,12,window.innerWidth-260-12);return M(U.left-260-14,12,window.innerWidth-260-12)}function iG(G,U){if(U==="right")return M(G.right+14,12,window.innerWidth-24-12);return M(G.left-24-14,12,window.innerWidth-24-12)}function dG(G){let U=HG(G);if(!U)return null;let V=U.getBoundingClientRect();if(!V.width&&!V.height)return null;return V}function rG(G){return Array.from(G.getClientRects()).filter((V)=>V.width||V.height).at(-1)??null}function HG(G){if(G instanceof Range)return G.cloneRange();try{let U=document.createRange();return U.setStart(G.startContainer,G.startOffset),U.setEnd(G.endContainer,G.endOffset),U}catch{return null}}function k(){if(d+=1,!I)return;window.cancelAnimationFrame(I),I=0}function oG(G,U,V){k();let Z=d;I=window.requestAnimationFrame(()=>{if(I=0,Z!==d)return;let $=_.selectionDraft;if(!$||!_.draftEditorOpen||AG($)!==U)return;if(G.popoverLayer.querySelector("textarea[data-field='draft']")!==V||!V.isConnected)return;f(V),V.focus({preventScroll:!0});let J=V.value.length;V.setSelectionRange(J,J)})}function f(G){if(!(G instanceof HTMLTextAreaElement))return;let U=window.getComputedStyle(G),V=parseFloat(U.lineHeight)||18,Z=parseFloat(U.paddingTop)+parseFloat(U.paddingBottom),$=parseFloat(U.borderTopWidth)+parseFloat(U.borderBottomWidth),X=V*4+Z+$;G.style.height="0px";let J=Math.min(G.scrollHeight,X);G.style.height=`${J}px`,G.style.overflowY=G.scrollHeight>X?"auto":"hidden"}function y(G){if(c)return;c=window.requestAnimationFrame(()=>{c=0,A(G)})}function W(){if(k(),x+=1,q)clearTimeout(q),q=null;_.selectionDraft=null,_.draftEditorOpen=!1,_.draftText="",document.getSelection()?.removeAllRanges()}function m(){return[..._.notes].sort((G,U)=>G.createdAt-U.createdAt)}function $G(G){let U=G instanceof HTMLElement?G:G?.parentElement??null;if(!U)return null;let V=U.closest("[data-message-author-role='assistant']");if(V)return V;return U.closest("article[data-message-author-role='assistant']")}function n(G){let U=G.getAttribute("data-plannotator-message-id");if(!U)U=G.getAttribute("data-message-id")??aG(G),G.setAttribute("data-plannotator-message-id",U);return U}function aG(G){let U=G.getAttribute("data-message-id");if(U)return U;let Z=t().indexOf(G),$=D(g(G)).slice(0,96);return`assistant-${Z}-${QU($)}`}function t(){return Array.from(document.querySelectorAll("[data-message-author-role='assistant'], article[data-message-author-role='assistant']"))}function KG(G){let U=G instanceof HTMLElement?G:G?.parentElement??null;if(!U)return!1;return Boolean(U.closest("#plannotator-chatgpt-root"))}function PG(G){try{return new StaticRange({startContainer:G.startContainer,startOffset:G.startOffset,endContainer:G.endContainer,endOffset:G.endOffset})}catch{return G.cloneRange()}}function nG(G,U){let V=document.createTreeWalker(G,NodeFilter.SHOW_TEXT),Z=0,$=0,X=0;while(V.nextNode()){let J=V.currentNode,Y=J.textContent?.length??0;if(J===U.startContainer)$=Z+U.startOffset;if(J===U.endContainer){X=Z+U.endOffset;break}Z+=Y}if(X<$)X=$+U.toString().length;return{start:$,end:X}}function g(G){let U=document.createTreeWalker(G,NodeFilter.SHOW_TEXT),V="";while(U.nextNode())V+=U.currentNode.textContent??"";return V}function D(G){return G.replace(/\s+/g," ").trim()}function XG(G,U){let V=D(G);if(V.length<=U)return V;return`${V.slice(0,U-1)}...`}function M(G,U,V){return Math.max(U,Math.min(V,G))}function tG(G){let U=window.getSelection();if(!U)return;let V=document.createRange();V.selectNodeContents(G),U.removeAllRanges(),U.addRange(V)}function i(G){return G.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function eG(G){let U=G.shadow.activeElement;return(U instanceof HTMLTextAreaElement||U instanceof HTMLInputElement)&&U.dataset.field==="draft"}function w(){return`plannotator-chatgpt-notes:v1:${window.location.origin}${window.location.pathname}`}function GU(G){try{let U=window.localStorage.getItem(G);if(!U)return[];let V=JSON.parse(U);if(!Array.isArray(V))return[];return V.flatMap((Z)=>{if(!UU(Z))return[];return[Z]})}catch{return[]}}function UU(G){if(!G||typeof G!=="object")return!1;let U=G;return typeof U.id==="string"&&typeof U.messageId==="string"&&typeof U.messageExcerpt==="string"&&typeof U.quote==="string"&&typeof U.comment==="string"&&typeof U.contextBefore==="string"&&typeof U.contextAfter==="string"&&(U.startOffset===void 0||typeof U.startOffset==="number")&&(U.endOffset===void 0||typeof U.endOffset==="number")&&typeof U.createdAt==="number"}function VU(){return m().map((G)=>({id:G.id,messageId:G.messageId,messageExcerpt:G.messageExcerpt,quote:G.quote,comment:G.comment,contextBefore:G.contextBefore,contextAfter:G.contextAfter,startOffset:G.startOffset,endOffset:G.endOffset,createdAt:G.createdAt}))}function e(G){if(F)return;F=window.requestAnimationFrame(()=>{F=0,ZU(G)})}function ZU(G){if(R.length===0){T(),A(G);return}let U=new Map(_.notes.map(($)=>[$.id,$])),V=[],Z=!1;for(let $ of R){if(U.has($.id))continue;let X=QG($);if(!X){V.push($);continue}if(U.set(X.id,X),!MG($)||X.quote!==$.quote)Z=!0}if(_.notes=Array.from(U.values()).sort(($,X)=>$.createdAt-X.createdAt),R=V,A(G),Z)S();if(R.length>0)_U(G);else T()}function _U(G){if(N||!document.body)return;N=new MutationObserver(()=>{e(G)}),N.observe(document.body,{childList:!0,subtree:!0,characterData:!0})}function T(){if(F)window.cancelAnimationFrame(F),F=0;N?.disconnect(),N=null}function QG(G){let U=$U(G);if(!U)return null;let V=JU(U,G);if(!V)return null;return{...G,messageId:n(U),quote:V.quote,startOffset:V.startOffset,endOffset:V.endOffset,range:PG(V.range)}}function $U(G){let U=XU(G.messageId);if(U)return U;let V=D(G.messageExcerpt),Z=null,$=-1;for(let X of t()){let J=D(g(X)),Y=0;if(V&&J.includes(V))Y+=V.length*2;if(G.quote&&J.includes(D(G.quote)))Y+=Math.min(D(G.quote).length,240);if(G.contextBefore&&J.includes(D(G.contextBefore)))Y+=G.contextBefore.length;if(G.contextAfter&&J.includes(D(G.contextAfter)))Y+=G.contextAfter.length;if(Y>$)$=Y,Z=X}return Z}function XU(G){let U=PU(G),V=document.querySelector(`[data-message-id="${U}"]`)??document.querySelector(`[data-plannotator-message-id="${U}"]`);if(V)return V.setAttribute("data-plannotator-message-id",G),V;for(let Z of t())if(n(Z)===G)return Z;return null}function JU(G,U){let V=g(G);if(!V)return null;if(MG(U)){let X=jG(G,U.startOffset,U.endOffset);if(X&&YU(X,U.quote))return{range:X,quote:D(X.toString())||U.quote,startOffset:U.startOffset,endOffset:U.endOffset}}let Z=jU(V,U);if(!Z)return null;let $=jG(G,Z.start,Z.end);if(!$)return null;return{range:$,quote:D($.toString())||U.quote,startOffset:Z.start,endOffset:Z.end}}function YU(G,U){let V=z(G.toString()),Z=z(U);return Boolean(V)&&V===Z}function jU(G,U){let V=D(U.quote);if(!V)return null;let Z=V.split(" ").filter(Boolean),$=EU(G);if(!$.text)return null;let X={contextBefore:D(U.contextBefore),contextAfter:D(U.contextAfter)},J=JG($.text,V,Z,X," ");if(J)return YG($,G.length,J.start,J.end);let Y=HU(G),j=z(U.quote);if(!Y.text||!j)return null;let C=JG(Y.text,j,Z,{contextBefore:z(U.contextBefore),contextAfter:z(U.contextAfter)},"");if(!C)return null;return YG(Y,G.length,C.start,C.end)}function JG(G,U,V,Z,$){let X=null,J=0;while(J<G.length){let Y=G.indexOf(U,J);if(Y===-1)break;let j=Y+U.length,C=RG(G,Y,j,Z);if(!X||C>X.score)X={start:Y,end:j,score:C};J=Y+Math.max(1,U.length)}if(X)return X;return CU(G,V,Z,$)}function RG(G,U,V,Z){let $=D(Z.contextBefore),X=D(Z.contextAfter),J=G.slice(Math.max(0,U-$.length),U),Y=G.slice(V,V+X.length);return AU(J,$)*2+DU(Y,X)*2}function CU(G,U,V,Z){if(U.length===0)return null;let $=Math.min(U.length,14),X=Math.min($,3),J=null;for(let Y=$;Y>=X;Y-=1){for(let j=0;j+Y<=U.length;j+=1){let C=U.slice(j,j+Y).join(Z),H=0;while(H<G.length){let E=G.indexOf(C,H);if(E===-1)break;let K=E+C.length,P=RG(G,E,K,V)+C.length*4-j;if(!J||P>J.score)J={start:E,end:K,score:P};H=E+Math.max(1,C.length)}}if(J)return J}return null}function AU(G,U){let V=0,Z=G.length-1,$=U.length-1;while(Z>=0&&$>=0){if(G[Z]!==U[$])break;V+=1,Z-=1,$-=1}return V}function DU(G,U){let V=0,Z=Math.min(G.length,U.length);while(V<Z){if(G[V]!==U[V])break;V+=1}return V}function EU(G){let U="",V=[],Z=!1,$=!1;for(let X=0;X<G.length;X+=1){let J=G[X];if(/\s/.test(J)){if(!Z||$)continue;U+=" ",V.push(X),$=!0;continue}U+=J,V.push(X),Z=!0,$=!1}if(U.endsWith(" "))U=U.slice(0,-1),V.pop();return{text:U,rawByNormalized:V}}function HU(G){let U="",V=[];for(let Z=0;Z<G.length;Z+=1){let $=G[Z];if(/\s/.test($))continue;U+=$,V.push(Z)}return{text:U,rawByNormalized:V}}function YG(G,U,V,Z){let $=G.rawByNormalized[V],X=Z<G.rawByNormalized.length?G.rawByNormalized[Z]:U;if(typeof $!=="number")return null;return{start:$,end:Math.max($+1,X)}}function jG(G,U,V){if(V<=U)return null;let Z=document.createTreeWalker(G,NodeFilter.SHOW_TEXT),$=0,X=null,J=null,Y=0,j=0,C=null;while(Z.nextNode()){let E=Z.currentNode,K=E.textContent?.length??0,P=$+K;if(C=E,!X&&U<=P)X=E,Y=M(U-$,0,K);if(!J&&V<=P){J=E,j=M(V-$,0,K);break}$=P}if(!X)return null;if(!J){if(!C)return null;J=C,j=C.textContent?.length??0}if(X===J&&j<=Y)return null;let H=document.createRange();return H.setStart(X,Y),H.setEnd(J,j),H.collapsed?null:H}function MG(G){return typeof G.startOffset==="number"&&typeof G.endOffset==="number"&&G.endOffset>G.startOffset}function CG(G){return JSON.stringify(D(G))}function KU(G){return G.replace(/\s+/g,"")}function z(G){return G.replace(/\s+/g,"")}function PU(G){let U=CSS;return U.escape?U.escape(G):G.replaceAll("\\","\\\\").replaceAll('"',"\\\"")}function QU(G){let U=5381;for(let V=0;V<G.length;V+=1)U=(U<<5)+U^G.charCodeAt(V);return Math.abs(U).toString(36)}function O(G){return}function b(){if(_.actionFeedback="idle",L)clearTimeout(L),L=null}function RU(G){b(),_.actionFeedback="inserted",L=window.setTimeout(()=>{_.actionFeedback="idle",L=null,A(G)},1400)}function MU(){return new Promise((G)=>window.requestAnimationFrame(()=>G()))}

//# debugId=7C401B10CE07183064756E2164756E21
//# sourceMappingURL=content.js.map
