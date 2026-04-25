const { Sequelize } = require("sequelize");

const sequelize = new Sequelize("yearfinal", "root", "lotus", {
    host: "localhost",
    dialect: "mysql"
});

(async () => {
    try {
        await sequelize.authenticate();
        console.log("Database connected successfully");
    } catch (error) {
        console.log("DB Error:", error)
    }
})();

module.exports = sequelize;
