// webinar.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUGuPMSy6z7XPFAf4heLGEe8mBmICLvJ8",
  authDomain: "mutual-celesol.firebaseapp.com",
  projectId: "mutual-celesol",
  storageBucket: "mutual-celesol.appspot.com",
  messagingSenderId: "1083639504859",
  appId: "1:1083639504859:web:c7ec09552281f804b611fe",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const slugInput = document.getElementById("slug");
const form = document.getElementById("webinarForm");
const list = document.getElementById("webinarList");
const newBtn = document.getElementById("newBtn");

const descriptionEditor = new Quill("#descriptionEditor", { theme: "snow" });
const heroTitleEditor = new Quill("#heroTitleEditor", { theme: "snow" });
const heroSubtitleEditor = new Quill("#heroSubtitleEditor", { theme: "snow" });

let editingSlug = null;

async function loadWebinars() {
  const querySnapshot = await getDocs(collection(db, "webinars"));
  list.innerHTML = "";
  querySnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const li = document.createElement("li");
    li.textContent = data.hero.title.ops[0]?.insert.trim() || docSnap.id;
    li.style.cursor = "pointer";
    li.onclick = () => loadWebinar(docSnap.id);
    list.appendChild(li);
  });
}

async function loadWebinar(slug) {
  const docRef = doc(db, "webinars", slug);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    editingSlug = slug;
    slugInput.value = slug;
    slugInput.disabled = true;
    heroTitleEditor.setContents(data.hero.title);
    heroSubtitleEditor.setContents(data.hero.subtitle);
    document.getElementById("heroDate").value = data.hero.date;
    document.getElementById("heroVideo").value = data.hero.video;
    document.getElementById("expertName").value = data.expert.name;
    document.getElementById("expertTitle").value = data.expert.title;
    document.getElementById("expertContent").value = data.expert.content;
    document.getElementById("expertItems").value = data.expert.items.join("\n");
    document.getElementById("topics").value = data.topic.join("\n");
    descriptionEditor.setContents(data.description);
    document.getElementById("interactTitle").value = data.interact.title;
    document.getElementById("interactSubtitle").value = data.interact.subtitle;
    document.getElementById("interactTimeTitle").value =
      data.interact.time.title;
    document.getElementById("interactTimeSubtitle").value =
      data.interact.time.subtitle;
    document.getElementById("interactCaseTitle").value =
      data.interact.case.title;
    document.getElementById("interactCaseSubtitle").value =
      data.interact.case.subtitle;
    document.getElementById("interactQuestionsTitle").value =
      data.interact.questions.title;
    document.getElementById("interactQuestionsSubtitle").value =
      data.interact.questions.subtitle;
    document.getElementById("interactQ1").value =
      data.interact.questions.item01;
    document.getElementById("interactQ2").value =
      data.interact.questions.item02;
    document.getElementById("interactQ3").value =
      data.interact.questions.item03;
    document.getElementById("val1Title").value = data.value.item01.title;
    document.getElementById("val1Subtitle").value = data.value.item01.subtitle;
    document.getElementById("val2Title").value = data.value.item02.title;
    document.getElementById("val2Subtitle").value = data.value.item02.subtitle;
    document.getElementById("val3Title").value = data.value.item03.title;
    document.getElementById("val3Subtitle").value = data.value.item03.subtitle;
    document.getElementById("footer").value = data.footer;
    form.style.display = "block";
    list.style.display = "none";
    newBtn.style.display = "none";
  }
}

newBtn.onclick = () => {
  editingSlug = null;
  form.reset();
  slugInput.disabled = false;
  slugInput.value = "";
  heroTitleEditor.setContents([]);
  heroSubtitleEditor.setContents([]);
  descriptionEditor.setContents([]);
  form.style.display = "block";
};

form.onsubmit = async (e) => {
  e.preventDefault();
  const slug = slugInput.value.trim();
  const data = {
    description: { ops: descriptionEditor.getContents().ops },
    hero: {
      title: { ops: heroTitleEditor.getContents().ops },
      subtitle: { ops: heroSubtitleEditor.getContents().ops },
      date: document.getElementById("heroDate").value,
      video: document.getElementById("heroVideo").value,
    },
    expert: {
      name: document.getElementById("expertName").value,
      title: document.getElementById("expertTitle").value,
      content: document.getElementById("expertContent").value,
      items: document.getElementById("expertItems").value.split("\n"),
    },
    topic: document.getElementById("topics").value.split("\n"),
    interact: {
      title: document.getElementById("interactTitle").value,
      subtitle: document.getElementById("interactSubtitle").value,
      time: {
        title: document.getElementById("interactTimeTitle").value,
        subtitle: document.getElementById("interactTimeSubtitle").value,
      },
      case: {
        title: document.getElementById("interactCaseTitle").value,
        subtitle: document.getElementById("interactCaseSubtitle").value,
      },
      questions: {
        title: document.getElementById("interactQuestionsTitle").value,
        subtitle: document.getElementById("interactQuestionsSubtitle").value,
        item01: document.getElementById("interactQ1").value,
        item02: document.getElementById("interactQ2").value,
        item03: document.getElementById("interactQ3").value,
      },
    },
    value: {
      item01: {
        title: document.getElementById("val1Title").value,
        subtitle: document.getElementById("val1Subtitle").value,
      },
      item02: {
        title: document.getElementById("val2Title").value,
        subtitle: document.getElementById("val2Subtitle").value,
      },
      item03: {
        title: document.getElementById("val3Title").value,
        subtitle: document.getElementById("val3Subtitle").value,
      },
    },
    footer: document.getElementById("footer").value,
  };

  await setDoc(doc(db, "webinars", slug), data);
  alert("Webinar guardado");
  loadWebinars();
};

loadWebinars();
