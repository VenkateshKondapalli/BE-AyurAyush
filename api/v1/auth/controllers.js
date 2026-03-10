const { signupUser, loginUser, checkEmailExists } = require("./services");

const userSignupController = async (req, res, next) => {
  try {
    const { name, email, phone, gender, dob, password } = req.body;

    const user = await signupUser({
      name,
      email,
      phone,
      gender,
      dob,
      password,
    });

    res.status(201).json({
      isSuccess: true,
      message: "User Created!",
      data: { user },
    });
  } catch (err) {
    next(err);
  }
};

const userLoginController = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { token, roles } = await loginUser({ email, password });

    res.cookie("authorization", token, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: 1 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      isSuccess: true,
      message: "User logged in!",
      data: { roles },
    });
  } catch (err) {
    next(err);
  }
};

const userLogoutController = async (req, res, next) => {
  try {
    res.cookie("authorization", "", {
      httpOnly: true,
      sameSite: "None",
      secure: true,
      maxAge: 0,
    });

    res.status(200).json({
      isSuccess: true,
      message: "User logged out!",
    });
  } catch (err) {
    next(err);
  }
};

const getCurrentUserController = (req, res, next) => {
  try {
    const { userId, roles } = req.currentUser;

    res.status(200).json({
      isSuccess: true,
      data: { userId, roles },
    });
  } catch (err) {
    next(err);
  }
};

const checkEmailExistsController = async (req, res, next) => {
  try {
    const { email } = req.query;
    const exists = await checkEmailExists(email);
    res.status(200).json({ exists });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  userSignupController,
  userLoginController,
  userLogoutController,
  getCurrentUserController,
  checkEmailExistsController,
};
