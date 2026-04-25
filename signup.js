document.getElementById("signupForm").addEventListener("submit", async e => {
    e.preventDefault();

    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        const res = await fetch("http://localhost:3000/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, password })
        });

        const data = await res.json();

        if (res.status === 409) {
            alert("User already exists");
            return;
        }

        if (res.ok) {
             let user = {
             name: name,
             email: email
             };

            localStorage.setItem("user", JSON.stringify(user));

            alert("Signup successful");
            window.location.href = "login.html";
        } else {
            alert("Signup failed");
        }
    } catch (err) {
        alert("Server not responding");
        console.error(err);
    }
});

function goToLogin() {
    window.location.href = "login.html";
}
