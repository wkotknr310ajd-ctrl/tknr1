Attribute VB_Name = "modMonthly"
Option Explicit

' 月初めの切り替え: 職員マスタ(氏名・パスワード)はそのまま引き継ぎ、
' 各部署のシフト表(シフト表_〇〇)の中身(職員名・シフト内容)だけを
' すべて消去して、新しい対象年月に切り替える。
' 履歴・職員マスタ・パスワードは一切変更しない。
Public Sub StartNewMonth()
    Dim cfg As Worksheet
    Set cfg = ThisWorkbook.Sheets("設定")

    Dim currentMonth As String
    If IsDate(cfg.Range("B1").Value) Then
        currentMonth = Format(CDate(cfg.Range("B1").Value), "yyyy年m月")
    Else
        currentMonth = "(未設定)"
    End If

    Dim newMonthStr As String
    newMonthStr = InputBox("新しい対象年月の1日を入力してください。(例: 2026/10/1)" & vbCrLf & _
                            "現在の設定: " & currentMonth, "月初めの切り替え")
    If newMonthStr = "" Then Exit Sub
    If Not IsDate(newMonthStr) Then
        MsgBox "日付を正しく入力してください。(例: 2026/10/1)", vbExclamation
        Exit Sub
    End If

    Dim newMonth As Date
    newMonth = CDate(newMonthStr)

    Dim deptNames As Collection
    Set deptNames = DepartmentSheetNames()

    Dim deptList As String
    Dim dn As Variant
    For Each dn In deptNames
        deptList = deptList & "・" & CStr(dn) & vbCrLf
    Next dn

    If MsgBox("以下の部署シートの内容(職員名・シフト内容)をすべて消去し、" & vbCrLf & _
              "対象年月を " & Format(newMonth, "yyyy年m月") & " に切り替えます。" & vbCrLf & vbCrLf & _
              deptList & vbCrLf & _
              "職員マスタ(氏名・パスワード)と履歴は変更されません。" & vbCrLf & vbCrLf & _
              "よろしいですか?", vbYesNo + vbExclamation, "月初めの切り替え") = vbNo Then
        Exit Sub
    End If

    cfg.Range("B1").Value = newMonth

    Dim ws As Worksheet
    For Each dn In deptNames
        Set ws = ThisWorkbook.Sheets(CStr(dn))

        Dim wasProtected As Boolean
        wasProtected = UnprotectIfNeeded(ws)

        Dim lastRow As Long
        lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        If lastRow >= 5 Then
            ws.Range(ws.Cells(5, 1), ws.Cells(lastRow, 32)).ClearContents
        End If

        ReprotectIfNeeded ws, wasProtected
    Next dn

    SetupChoiceLists

    MsgBox "対象年月を " & Format(newMonth, "yyyy年m月") & " に切り替え、部署シートをリセットしました。" & vbCrLf & vbCrLf & _
           "続けて「ImportShiftTable」(取り込み)または手入力で、新しい月のシフトデータを入力してください。", _
           vbInformation

    ThisWorkbook.Save
End Sub
