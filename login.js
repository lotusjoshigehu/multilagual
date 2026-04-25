document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        const res = await fetch("http://localhost:3000/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok) {
          
             let user = {
        name: data.name || email.split("@")[0],   // 🔥 fallback name
        email: email
    };

           localStorage.setItem("user", JSON.stringify(user));
            // ✅ FIXED HERE
            localStorage.setItem("loggedIn", "true");
            localStorage.setItem("userEmail", email);

            window.location.href = "voice.html";
        } else {
            alert(data.message || "Login failed");
        }
    } catch (err) {
        alert("Server not responding");
        console.error(err);
    }
});

function goToSignup() {
    window.location.href = "signup.html";
}