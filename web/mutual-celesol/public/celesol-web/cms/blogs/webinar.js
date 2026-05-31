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
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUGuPMSy6z7XPFAf4heLGEe8mBmICLvJ8",
  authDomain: "mutual-celesol.firebaseapp.com",
  projectId: "mutual-celesol",
  storageBucket: "mutual-celesol.firebasestorage.app",
  messagingSenderId: "1083639504859",
  appId: "1:1083639504859:web:c7ec09552281f804b611fe",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const slugInput = document.getElementById("slug");
const form = document.getElementById("webinarForm");
const list = document.getElementById("webinarList");
const newBtn = document.getElementById("newBtn");
const returnBtn = document.getElementById("returnBtn");

const descriptionEditor = new Quill("#descriptionEditor", { theme: "snow" });
const heroTitleEditor = document.getElementById("heroTitleEditor");
const heroSubtitleEditor = document.getElementById("heroSubtitleEditor");

let editingSlug = null;

async function loadWebinars() {
  const querySnapshot = await getDocs(collection(db, "blogs"));
  list.innerHTML = "";
  querySnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const li = document.createElement("li");
    li.textContent = data.hero.title || docSnap.id;
    li.style.cursor = "pointer";
    li.onclick = () => loadWebinar(docSnap.id);
    list.appendChild(li);
  });
}

async function loadWebinar(slug) {
  const docRef = doc(db, "blogs", slug);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    editingSlug = slug;
    slugInput.value = slug;
    slugInput.disabled = true;
    heroTitleEditor.value = data.hero.title;
    heroSubtitleEditor.value = data.hero.subtitle;

    let dateValue = "";
    if (data.hero.date && data.hero.date.seconds) {
      const jsDate = data.hero.date.toDate
        ? data.hero.date.toDate()
        : new Date(data.hero.date.seconds * 1000);
      dateValue = jsDate.toISOString().split("T")[0];
    }
    document.getElementById("heroDate").value = dateValue;

    descriptionEditor.setContents(data.description);
    form.style.display = "block";
    list.style.display = "none";
    newBtn.style.display = "none";
    returnBtn.style.display = "block";
  }
}

newBtn.onclick = () => {
  editingSlug = null;
  form.reset();
  slugInput.disabled = false;
  slugInput.value = "";
  heroTitleEditor.value = "";
  heroSubtitleEditor.value = "";
  descriptionEditor.setContents([]);
  form.style.display = "block";
};

form.onsubmit = async (e) => {
  e.preventDefault();
  const slug = slugInput.value.trim();

  const heroImageInput = document.getElementById("heroImage");
  let imageUrl = null;
  const thumbImageInput = document.getElementById("thumbImage");
  let thumbUrl = null;

  try {
    if (heroImageInput.files && heroImageInput.files[0]) {
      const file = heroImageInput.files[0];
      const storage = getStorage(app);
      const imgRef = storageRef(storage, `blogs/${slug}/heroImage.png`);
      await uploadBytes(imgRef, file);
      imageUrl = await getDownloadURL(imgRef);
    }
  } catch (error) {
    console.log(error);
  }

  try {
    if (thumbImageInput.files && thumbImageInput.files[0]) {
      const file = thumbImageInput.files[0];
      const storage = getStorage(app);
      const imgRef = storageRef(storage, `blogs/${slug}/thumbImage.png`);
      await uploadBytes(imgRef, file);
      thumbUrl = await getDownloadURL(imgRef);
    }
  } catch (error) {
    console.log(error);
  }

  console.log("slug:", slug);

  const dateInput = document.getElementById("heroDate").value;
  let dateTimestamp = null;
  if (dateInput) {
    dateTimestamp = new Date(dateInput + "T00:00:00");
    //dateTimestamp = Timestamp.fromDate(jsDate);
  }

  if (!imageUrl && editingSlug) {
    const docRef = doc(db, "blogs", slug);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().hero?.image) {
      imageUrl = docSnap.data().hero.image;
    }
    if (docSnap.exists() && docSnap.data().hero?.thumb) {
      imageUrl = docSnap.data().hero.thumb;
    }
  }

  const data = {
    description: { ops: descriptionEditor.getContents().ops },
    hero: {
      title: heroTitleEditor.value,
      subtitle: heroSubtitleEditor.value,
      date: dateTimestamp,
      image: imageUrl || null,
      thumb: thumbUrl || null,
    },
  };

  await setDoc(doc(db, "blogs", slug), data);
  alert("Blog guardado");
  loadWebinars();
};

loadWebinars();
