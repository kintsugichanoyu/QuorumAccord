fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let program = std::path::PathBuf::from(args.next().ok_or("program path required")?);
    let output = std::path::PathBuf::from(args.next().ok_or("output path required")?);
    let idl = anchor_lang_idl::build::IdlBuilder::new()
        .program_path(program)
        .resolution(false)
        .cargo_args(vec!["--locked".into()])
        .build()?;
    std::fs::create_dir_all(output.parent().ok_or("output directory required")?)?;
    std::fs::write(&output, serde_json::to_string_pretty(&idl)? + "\n")?;
    println!("Built IDL: {}", output.display());
    Ok(())
}
