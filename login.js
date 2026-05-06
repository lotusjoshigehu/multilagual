document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
        const res = await fetch("https://multilagual.onrender.com/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok) {

            localStorage.clear();

            const user = {
                name: data.name || email.split("@")[0],
                email: email
            };

            localStorage.setItem("user", JSON.stringify(user));

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