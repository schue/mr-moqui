// System › Theme (plans/Themes.md, Branding): the look of the current Quasar theme without code. The screen finds the
// theme the shell renders through get#Appearance and keeps its resources, its color schemes and their colors on the
// generic CRUD services.
// Run: ./moq test tools --spec Theme
const system = () => ec.screen.makeTest().rootScreen("component://tools/screen/System.xml")

spec({
    setupSpec() { login("john.doe") },
})

feature("the Theme screen keeps the theme the shell renders, with its schemes and the policy in effect", {
    expect() {
        const page = system().render("Theme", {}, null)
        const output = String(page.output || "")
        page.status == 200
        page.errorMessages.length == 0
        !/Error rendering|Exception in render/.test(output)
        // the theme the shell renders (DEFAULT_QUASAR for the spec user) and the policy and default scheme in effect
        output.includes("The look of the theme DEFAULT_QUASAR")
        output.includes("the preferences the policy locks: THEME_PRIMARY_COLOR, THEME_PRIMARY_COLOR_DARK")
        output.includes("the default scheme none")
        // the seeded schemes of the theme, each with its colors, and the fonts a scheme may name
        output.includes(">SLATE<") && output.includes(">LAB<") && output.includes(">OPENSTEP<") && output.includes(">WINDOWS_11<")
        output.includes("SCM_LIGHT") && output.includes("SCM_DARK")
        output.includes("Orbitron (the Lab scheme")
        // the resources of the theme, the appearance policy among them
        output.includes("STRT_HEADER_LOGO")
        output.includes("Appearance Policy")
    },
})
