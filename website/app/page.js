"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Home;
const Navbar_1 = require("./components/Navbar/Navbar");
const Hero_1 = require("./components/Hero/Hero");
const MarqueeBanner_1 = require("./components/sections/MarqueeBanner");
const WhyStarknet_1 = require("./components/sections/WhyStarknet");
const Vision_1 = require("./components/sections/Vision");
const FeaturedApps_1 = require("./components/sections/FeaturedApps");
const Architecture_1 = require("./components/sections/Architecture");
const GetStarted_1 = require("./components/sections/GetStarted");
const Footer_1 = require("./components/sections/Footer");
function Home() {
    return (<main className="min-h-screen overflow-x-hidden">
      <Navbar_1.Navbar />
      <Hero_1.Hero />
      <MarqueeBanner_1.MarqueeBanner />
      <WhyStarknet_1.WhyStarknet />
      <Vision_1.Vision />
      <FeaturedApps_1.FeaturedApps />
      <Architecture_1.Architecture />
      <GetStarted_1.GetStarted />
      <Footer_1.Footer />
    </main>);
}
