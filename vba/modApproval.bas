Attribute VB_Name = "modApproval"
Option Explicit

' 「承認」シートの申請待ち一覧を履歴シートから再構築する。
Public Sub RefreshPendingList()
    Dim hist As Worksheet, appr As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Set appr = ThisWorkbook.Sheets("承認")

    Const HEADER_ROW As Long = 12
    Const FIRST_DATA_ROW As Long = 13

    Dim lastClear As Long
    lastClear = appr.Cells(appr.Rows.Count, 1).End(xlUp).Row
    If lastClear >= FIRST_DATA_ROW Then
        appr.Range(appr.Cells(FIRST_DATA_ROW, 1), appr.Cells(lastClear, 7)).ClearContents
    End If

    Dim lastHistRow As Long
    lastHistRow = hist.Cells(hist.Rows.Count, 1).End(xlUp).Row

    Dim outRow As Long
    outRow = FIRST_DATA_ROW
    Dim r As Long
    For r = 2 To lastHistRow
        If CStr(hist.Cells(r, 8).Value) = "申請中" Then
            appr.Cells(outRow, 1).Value = hist.Cells(r, 1).Value
            appr.Cells(outRow, 2).Value = hist.Cells(r, 3).Value
            appr.Cells(outRow, 3).Value = hist.Cells(r, 4).Value
            appr.Cells(outRow, 3).NumberFormat = "yyyy/mm/dd"
            appr.Cells(outRow, 4).Value = hist.Cells(r, 5).Value
            appr.Cells(outRow, 5).Value = hist.Cells(r, 6).Value
            appr.Cells(outRow, 6).Value = hist.Cells(r, 7).Value
            appr.Cells(outRow, 7).Value = hist.Cells(r, 2).Value
            appr.Cells(outRow, 7).NumberFormat = "yyyy/mm/dd hh:mm:ss"
            outRow = outRow + 1
        End If
    Next r

    Dim lastRow As Long
    lastRow = appr.Cells(appr.Rows.Count, 1).End(xlUp).Row
    With appr.Range("B3").Validation
        .Delete
        If lastRow >= FIRST_DATA_ROW Then
            .Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, _
                 Formula1:="=承認!$A$" & FIRST_DATA_ROW & ":$A$" & lastRow
        End If
    End With
End Sub

' 「承認」シートの入力内容にもとづき、承認または却下を実行する。
' 承認時のみシフト表へ反映する。
Public Sub ProcessApproval()
    Dim appr As Worksheet
    Set appr = ThisWorkbook.Sheets("承認")

    Dim targetId As String, apprName As String, pwd As String, decision As String
    targetId = Trim$(CStr(appr.Range("B3").Value))
    apprName = Trim$(CStr(appr.Range("B4").Value))
    pwd = CStr(appr.Range("B5").Value)
    decision = Trim$(CStr(appr.Range("B6").Value))

    If targetId = "" Then
        MsgBox "対象の申請IDを選択してください。", vbExclamation
        Exit Sub
    End If
    If apprName = "" Then
        MsgBox "承認者氏名を入力してください。", vbExclamation
        Exit Sub
    End If
    If decision <> "承認" And decision <> "却下" Then
        MsgBox "判定は「承認」または「却下」を選択してください。", vbExclamation
        Exit Sub
    End If

    Dim masterWs As Worksheet
    Set masterWs = ThisWorkbook.Sheets("職員マスタ")
    Dim staffRow As Long
    staffRow = FindStaffMasterRow(apprName)
    If staffRow = 0 Then
        MsgBox apprName & " は職員マスタに登録されていません。", vbCritical
        Exit Sub
    End If
    If InStr(CStr(masterWs.Cells(staffRow, 2).Value), "承認者") = 0 Then
        MsgBox apprName & " には承認権限がありません。", vbCritical
        Exit Sub
    End If

    Dim salt As String, storedHash As String
    salt = CStr(masterWs.Cells(staffRow, 3).Value)
    storedHash = CStr(masterWs.Cells(staffRow, 4).Value)
    If Not VerifyPassword(pwd, salt, storedHash) Then
        MsgBox "パスワードが正しくありません。", vbCritical
        appr.Range("B5").Value = ""
        Exit Sub
    End If

    Dim hist As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Dim histRow As Long
    histRow = FindHistoryRowById(targetId)
    If histRow = 0 Then
        MsgBox "対象の申請が見つかりません。既に処理済みの可能性があります。", vbCritical
        RefreshPendingList
        Exit Sub
    End If
    If CStr(hist.Cells(histRow, 8).Value) <> "申請中" Then
        MsgBox "この申請は既に処理済みです。", vbExclamation
        RefreshPendingList
        Exit Sub
    End If

    If decision = "却下" Then
        hist.Cells(histRow, 8).Value = "却下"
        hist.Cells(histRow, 9).Value = apprName
        hist.Cells(histRow, 10).Value = Now
        hist.Cells(histRow, 10).NumberFormat = "yyyy/mm/dd hh:mm:ss"
        MsgBox "申請を却下しました。", vbInformation
    Else
        Dim staffName As String, targetDate As Date, newShift As String
        staffName = CStr(hist.Cells(histRow, 3).Value)
        targetDate = CDate(hist.Cells(histRow, 4).Value)
        newShift = CStr(hist.Cells(histRow, 6).Value)

        Dim shiftRow As Long, shiftCol As Long
        shiftRow = FindShiftStaffRow(staffName)
        shiftCol = FindShiftDayColumn(Day(targetDate))
        If shiftRow = 0 Or shiftCol = 0 Then
            MsgBox "シフト表の対象セルが見つかりません。管理者に確認してください。", vbCritical
            Exit Sub
        End If

        Dim shiftWs As Worksheet
        Set shiftWs = ThisWorkbook.Sheets("シフト表")

        Dim actualCurrent As String
        actualCurrent = CStr(shiftWs.Cells(shiftRow, shiftCol).Value)
        If actualCurrent <> CStr(hist.Cells(histRow, 5).Value) Then
            If MsgBox("シフト表の現在値が申請時と異なります(現在: " & actualCurrent & ")。" & vbCrLf & _
                      "このまま「" & newShift & "」で上書きしてよろしいですか?", vbYesNo + vbExclamation) = vbNo Then
                Exit Sub
            End If
        End If

        shiftWs.Cells(shiftRow, shiftCol).Value = newShift

        hist.Cells(histRow, 8).Value = "承認"
        hist.Cells(histRow, 9).Value = apprName
        hist.Cells(histRow, 10).Value = Now
        hist.Cells(histRow, 10).NumberFormat = "yyyy/mm/dd hh:mm:ss"

        MsgBox "承認しました。シフト表に反映しました。", vbInformation
    End If

    appr.Range("B3").Value = ""
    appr.Range("B5").Value = ""
    appr.Range("B6").Value = ""

    RefreshPendingList
    RefreshApprovedList
    ThisWorkbook.Save
End Sub
