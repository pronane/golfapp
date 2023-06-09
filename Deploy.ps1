# Step 1: Run npm build or npm custom-build
$npmBuildPath = "D:\React_Apps\Crud-Operations-in-ReactJS"
Set-Location $npmBuildPath
npm run build-custom

# Step 2: Copy and overwrite folder
$sourceFolder = Join-Path $npmBuildPath "src"
$destinationFolder = "D:\golf-app\reactSrc"
Copy-Item -Path $sourceFolder -Destination $destinationFolder -Recurse -Force

# Step 3: Copy and overwrite bundle.js
$sourceFile = Join-Path $npmBuildPath "dist\bundle.js"
$destinationFile = "D:\golf-app\src\main\resources\static\bundle.js"
Copy-Item -Path $sourceFile -Destination $destinationFile -Force

# Step 4: Stop any running java bootRun processes
Stop-Process -Name "java" -ErrorAction SilentlyContinue

# Step 5: Run gradlew bootJar
$gradlePath = "D:\golf-app"
Set-Location $gradlePath
.\gradlew bootJar

# Step 6: Copy my-app.jar using scp (in background job)
$sourceJar = Join-Path $gradlePath "build\libs\my-app.jar"
$destinationAddress = "root@82.180.154.143:/usr/local/"
$copyJob = Start-Job -ScriptBlock {
    scp $using:sourceJar $using:destinationAddress
}


# Step 7: Run my-app.jar using java
$jarPath = Join-Path $gradlePath "build\libs\my-app.jar"
java -jar $jarPath
