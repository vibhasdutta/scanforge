param()

$rootDir = Split-Path -Parent $PSScriptRoot
$icoPath = Join-Path $rootDir 'assets\derived\scanforge.ico'
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

# 1. Build ScanForge Companion Launcher (Headless / Native Messaging)
$companionSrc = Join-Path $rootDir 'bin\ScanForgeCompanion.cs'
$companionBin = Join-Path $rootDir 'bin\scanforge-companion.exe'

$companionCode = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("ScanForge Companion")]
[assembly: AssemblyProduct("ScanForge")]
[assembly: AssemblyDescription("ScanForge Headless Companion Server")]
[assembly: AssemblyCompany("ScanForge")]
[assembly: AssemblyVersion("1.0.2.0")]
[assembly: AssemblyFileVersion("1.0.2.0")]

namespace ScanForgeLauncher
{
    class Program
    {
        static string FindNode(string rootDir)
        {
            string nodeBinTxt = Path.Combine(rootDir, "node_bin.txt");
            if (File.Exists(nodeBinTxt))
            {
                string path = File.ReadAllText(nodeBinTxt).Trim();
                if (File.Exists(path)) return path;
            }
            string defaultProg = @"C:\Program Files\nodejs\node.exe";
            if (File.Exists(defaultProg)) return defaultProg;
            return "node";
        }

        static void ForwardStream(Stream source, Stream destination)
        {
            byte[] buffer = new byte[4096];
            int bytesRead;
            try
            {
                while ((bytesRead = source.Read(buffer, 0, buffer.Length)) > 0)
                {
                    destination.Write(buffer, 0, bytesRead);
                    destination.Flush();
                }
            }
            catch { }
        }

        static byte[] ReadExactly(Stream source, int count)
        {
            byte[] buffer = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int read = source.Read(buffer, offset, count - offset);
                if (read <= 0) throw new EndOfStreamException("native-host.js closed its output before sending a full response.");
                offset += read;
            }
            return buffer;
        }

        // Relays exactly ONE native-messaging-framed response (4-byte little-endian length,
        // then that many bytes of JSON) instead of streaming until end-of-file. The 'start'
        // and 'restart' actions launch a long-lived, detached companion server; on Windows
        // that detached process can end up holding a duplicate handle of this launcher's
        // redirected stdout pipe (a known .NET RedirectStandardOutput inheritance gotcha),
        // so the pipe never actually reaches EOF and a blind forward-until-EOF read would
        // hang forever even though native-host.js already wrote its response and exited.
        // Reading the exact framed length sidesteps that entirely.
        static void RelayOneMessage(Stream source, Stream destination)
        {
            byte[] header = ReadExactly(source, 4);
            destination.Write(header, 0, 4);
            uint length = BitConverter.ToUInt32(header, 0);
            if (length > 0)
            {
                byte[] payload = ReadExactly(source, (int)length);
                destination.Write(payload, 0, payload.Length);
            }
            destination.Flush();
        }

        static int Main(string[] args)
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string rootDir = Path.GetFullPath(Path.Combine(exeDir, ".."));
            if (!Directory.Exists(Path.Combine(rootDir, "src")))
            {
                rootDir = exeDir;
            }

            string nodePath = FindNode(rootDir);
            string scriptPath = Path.Combine(rootDir, "src", "companion", "native-host.js");

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "\"" + scriptPath + "\" " + string.Join(" ", args),
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = rootDir
            };

            using (Process proc = new Process { StartInfo = psi })
            {
                proc.Start();

                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        using (Stream input = Console.OpenStandardInput())
                        {
                            ForwardStream(input, proc.StandardInput.BaseStream);
                        }
                        proc.StandardInput.Close();
                    }
                    catch { }
                });

                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        using (Stream err = Console.OpenStandardError())
                        {
                            ForwardStream(proc.StandardError.BaseStream, err);
                        }
                    }
                    catch { }
                });

                try
                {
                    using (Stream output = Console.OpenStandardOutput())
                    {
                        RelayOneMessage(proc.StandardOutput.BaseStream, output);
                    }
                }
                catch { }

                // native-host.js exits on its own right after writing its response (verified
                // independently of this launcher). A 'start'/'restart' action's detached child
                // keeps running afterward and must not block this launcher's return to Chrome,
                // so this is a best-effort reap with a short timeout, not a hard wait.
                proc.WaitForExit(2000);
                return 0;
            }
        }
    }
}
"@

[System.IO.File]::WriteAllText($companionSrc, $companionCode)
& $csc /nologo /optimize /target:winexe "/win32icon:$icoPath" "/out:$companionBin" $companionSrc

# 2. Build ScanForge CLI Launcher
$cliSrc = Join-Path $rootDir 'bin\ScanForgeCli.cs'
$cliBin = Join-Path $rootDir 'bin\scanforge.exe'

$cliCode = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("ScanForge")]
[assembly: AssemblyProduct("ScanForge")]
[assembly: AssemblyDescription("ScanForge Lighthouse CLI & TUI")]
[assembly: AssemblyCompany("ScanForge")]
[assembly: AssemblyVersion("1.0.2.0")]
[assembly: AssemblyFileVersion("1.0.2.0")]

namespace ScanForgeCli
{
    class Program
    {
        static string FindNode(string rootDir)
        {
            string nodeBinTxt = Path.Combine(rootDir, "node_bin.txt");
            if (File.Exists(nodeBinTxt))
            {
                string path = File.ReadAllText(nodeBinTxt).Trim();
                if (File.Exists(path)) return path;
            }
            string defaultProg = @"C:\Program Files\nodejs\node.exe";
            if (File.Exists(defaultProg)) return defaultProg;
            return "node";
        }

        static int Main(string[] args)
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string rootDir = Path.GetFullPath(Path.Combine(exeDir, ".."));
            if (!Directory.Exists(Path.Combine(rootDir, "bin"))) rootDir = exeDir;

            string nodePath = FindNode(rootDir);
            string scriptPath = Path.Combine(rootDir, "bin", "scanforge.js");

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "\"" + scriptPath + "\" " + string.Join(" ", args),
                UseShellExecute = false,
                WorkingDirectory = Environment.CurrentDirectory
            };

            using (Process proc = Process.Start(psi))
            {
                proc.WaitForExit();
                return proc.ExitCode;
            }
        }
    }
}
"@

[System.IO.File]::WriteAllText($cliSrc, $cliCode)
& $csc /nologo /optimize /target:exe "/win32icon:$icoPath" "/out:$cliBin" $cliSrc

Write-Host "✅ Built ScanForge native executables with official icon and metadata in bin/"
